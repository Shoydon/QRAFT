'use client';

import { createPublicClient, custom, encodeFunctionData, getAddress, keccak256, type Hex } from 'viem';
import { DEPLOYMENT, DEPLOYMENT_MANIFEST, type PoolConfig } from '@/config/pool';
import type { PrivateNote } from '@/lib/note';
import { toHex32 } from '@/lib/note';
import { poolAbi, type NativeProof } from '@/lib/protocol/pool';
import { NoteTree } from '@/lib/protocol/tree';
import { proveWithdrawal } from '@/lib/protocol/prover';
import type { ChainTransport } from '@/lib/transport/types';
import { detectInjected, resolveAccountAdapter } from './account';
import { assertWalletContext } from './wallet-context';
import type { Backend, SubmissionResult, TxOutcome } from './types';

const reason = (error: unknown) => error instanceof Error ? error.message.split('\n')[0]! : 'The network could not be reached.';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function chainBackend(transport: ChainTransport): Backend {
  const client = createPublicClient({ cacheTime: 0, transport: custom({ request: ({ method, params }) => transport.request(method, params as unknown[] | undefined) }, { retryCount: 0 }) });
  const account = resolveAccountAdapter();
  let checking: Promise<void> | null = null;
  let checkedAt = 0;

  async function verifyDeployment(force = false) {
    if (!force && Date.now() - checkedAt < 30_000) return;
    if (!checking) {
      checking = (async () => {
        const [chainId, genesis, anchor] = await Promise.all([
          client.getChainId(), client.getBlock({ blockNumber: 0n }),
          client.getBlock({ blockNumber: BigInt(DEPLOYMENT_MANIFEST.anchorBlock) }),
        ]);
        if (chainId !== DEPLOYMENT.chainId || genesis.hash !== DEPLOYMENT_MANIFEST.genesisHash || anchor.hash !== DEPLOYMENT_MANIFEST.anchorHash) throw Error('The network was reset or the RPC points to a different deployment. Keep your note; do not deposit.');
        await Promise.all(Object.entries(DEPLOYMENT_MANIFEST.codeHashes).map(async ([address, expected]) => {
          const code = await client.getCode({ address: address as Hex });
          if (!code || keccak256(code) !== expected) throw Error('Pool code does not match the deployment. Keep your note; transactions are disabled.');
        }));
        checkedAt = Date.now();
      })().finally(() => { checking = null; });
    }
    await checking;
  }

  function address(pool: PoolConfig): Hex {
    const known = DEPLOYMENT.pools.find(item => item.ref === pool.ref);
    if (!known?.address || known.address !== pool.address || known.denominationWei !== pool.denominationWei) throw Error('Unknown pool configuration.');
    return known.address;
  }

  async function snapshot(pool: PoolConfig) {
    await verifyDeployment();
    const target = address(pool);
    const block = await client.getBlock();
    const tree = new NoteTree();
    const indices = new Map<string, { index: number; block: number }>();
    for (let fromBlock = BigInt(DEPLOYMENT_MANIFEST.deploymentBlock); fromBlock <= block.number; fromBlock += 2000n) {
      const toBlock = fromBlock + 1999n > block.number ? block.number : fromBlock + 1999n;
      const logs = await client.getContractEvents({ address: target, abi: poolAbi, eventName: 'Deposit', fromBlock, toBlock, strict: true });
      for (const log of logs.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex)) {
        if (log.removed || log.args.leafIndex !== tree.leaves.length) throw Error('Deposit history is incomplete. Keep your note and retry the read.');
        tree.insert(BigInt(log.args.commitment));
        if (toHex32(tree.root()) !== log.args.root) throw Error('Deposit history does not match the pool tree.');
        indices.set(log.args.commitment.toLowerCase(), { index: log.args.leafIndex, block: Number(log.blockNumber) });
      }
    }
    const root = await client.readContract({ address: target, abi: poolAbi, functionName: 'currentRoot', blockNumber: block.number });
    if (root !== toHex32(tree.root())) throw Error('The RPC returned inconsistent pool history. Keep your note and retry.');
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw Error('The chain changed during note lookup. Retry the read.');
    return { tree, indices, block };
  }

  function verifyNote(note: PrivateNote, pool: PoolConfig) {
    address(pool);
    if (note.deploymentId !== DEPLOYMENT.id || note.chainId !== DEPLOYMENT.chainId || note.poolRef !== pool.ref) throw Error('The note belongs to another deployment.');
  }

  async function send(pool: PoolConfig, data: Hex, value: bigint, expectedFrom?: Hex): Promise<SubmissionResult> {
    let provider;
    let from: Hex;
    let gas: Hex;
    try {
      await verifyDeployment(true);
      provider = detectInjected();
      if (!provider) throw Error('Install an Ethereum browser wallet to submit this transaction.');
      const chainId = Number(BigInt(await provider.request({ method: 'eth_chainId' }) as string));
      if (chainId !== DEPLOYMENT.chainId) throw Error(`Switch your wallet to ${DEPLOYMENT.chainName}.`);
      const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
      if (!accounts[0]) throw Error('Connect a wallet to pay transaction gas.');
      from = getAddress(accounts[0]);
      if (expectedFrom && from.toLowerCase() !== expectedFrom.toLowerCase()) throw Error('Wallet account changed. Review the transaction again.');
      const estimate = await client.estimateGas({ account: from, to: address(pool), data, value });
      gas = `0x${(estimate * 12n / 10n + 10000n).toString(16)}`;
      // Anonymous estimation may take time. Recheck the wallet after that wait.
      await assertWalletContext(provider, DEPLOYMENT.chainId, from);
    } catch (error) { return { kind: 'not-sent', reason: reason(error) }; }
    try {
      const txHash = await provider.request({ method: 'eth_sendTransaction', params: [{ chainId: `0x${DEPLOYMENT.chainId.toString(16)}`, from, to: address(pool), data, value: `0x${value.toString(16)}`, gas }] });
      if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { kind: 'unknown', txHash: null, reason: 'Your wallet did not return a valid transaction hash. Check its activity before trying again.' };
      return { kind: 'submitted', txHash: txHash as Hex, simulated: false };
    } catch (error) {
      // Only an explicit rejection establishes that the wallet sent nothing.
      if (error && typeof error === 'object' && 'code' in error && error.code === 4001) return { kind: 'not-sent', reason: 'You declined the transaction. Your note is unchanged.' };
      return { kind: 'unknown', txHash: null, reason: 'Your wallet request did not finish. Check wallet activity before retrying; the transaction may have been sent.' };
    }
  }

  const submitted = new Map<Hex, { pool: Hex; event: 'Deposit' | 'Withdrawal'; identity: Hex; recipient?: Hex }>();
  async function check(txHash: Hex): Promise<TxOutcome> {
    try {
      await verifyDeployment();
      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(error => {
        if (error.name === 'TransactionReceiptNotFoundError') return null;
        throw error;
      });
      if (!receipt) return { kind: 'pending', seenInMempool: false };
      if ((await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) return { kind: 'unknown', txHash, reason: 'This receipt is no longer on the canonical chain. Keep your note and recheck.' };
      if (receipt.status === 'reverted') return { kind: 'failed', txHash, reason: 'The transaction reverted. The deposit or withdrawal did not complete; the gas payer still paid gas.' };
      const expected = submitted.get(txHash);
      if (expected) {
        const { decodeEventLog } = await import('viem');
        const matched = receipt.logs.some(log => {
          if (log.address.toLowerCase() !== expected.pool.toLowerCase()) return false;
          try {
            const event = decodeEventLog({ abi: poolAbi, topics: log.topics, data: log.data });
            return event.eventName === expected.event && (event.eventName === 'Deposit'
              ? event.args.commitment.toLowerCase() === expected.identity.toLowerCase()
              : event.args.nullifierHash.toLowerCase() === expected.identity.toLowerCase() && event.args.recipient.toLowerCase() === expected.recipient?.toLowerCase());
          } catch { return false; }
        });
        if (!matched) return { kind: 'unknown', txHash, reason: 'The receipt does not contain the expected pool action. Keep your note and inspect wallet activity.' };
      }
      void account.refreshBalance();
      return { kind: 'confirmed', txHash, blockNumber: Number(receipt.blockNumber), gasUsed: receipt.gasUsed, simulated: false };
    } catch { return { kind: 'unknown', txHash, reason: 'The confirmation could not be read. Keep your note and check again; do not resend yet.' }; }
  }

  return {
    kind: 'chain', account,
    poolStats: { async stats(pool) {
      try {
        await verifyDeployment();
        const [deposits, withdrawals] = await Promise.all([
          client.readContract({ address: address(pool), abi: poolAbi, functionName: 'nextIndex' }),
          client.readContract({ address: address(pool), abi: poolAbi, functionName: 'withdrawalCount' }),
        ]);
        return { anonymitySet: Number(deposits - withdrawals), lastDepositAt: null, simulated: false };
      } catch { return null; }
    } },
    deposit: {
      async estimateFee() {
        try {
          const baseFeePerGas = await client.getGasPrice();
          return { baseFeePerGas, gasLimit: null, totalWei: null, source: 'live', detail: 'Gas is estimated against the pool before your wallet opens; your wallet pays it.' };
        } catch { return { baseFeePerGas: null, gasLimit: null, totalWei: null, source: 'unavailable', detail: 'Waiting for anonymous RPC reads.' }; }
      },
      async submit(request, onPhase) {
        onPhase({ kind: 'signing', label: 'Checking the pool and opening your wallet' });
        const result = await send(request.pool, encodeFunctionData({ abi: poolAbi, functionName: 'deposit', args: [request.commitment] }), request.pool.denominationWei, request.from);
        if (result.kind === 'submitted') {
          submitted.set(result.txHash, { pool: address(request.pool), event: 'Deposit', identity: request.commitment });
          onPhase({ kind: 'submitted', label: 'Waiting for confirmation', txHash: result.txHash });
        }
        return result;
      },
    },
    noteStatus: { async check(note, pool) {
      try {
        verifyNote(note, pool);
        const s = await snapshot(pool);
        if (await client.readContract({ address: address(pool), abi: poolAbi, functionName: 'spent', args: [note.nullifierHash], blockNumber: s.block.number })) return { kind: 'spent', spentTxHash: null, simulated: false };
        const leaf = s.indices.get(note.commitment.toLowerCase());
        return leaf ? { kind: 'ready', leafIndex: leaf.index, depositBlock: leaf.block, simulated: false } : { kind: 'pending', detail: 'No confirmed deposit matches this note on this deployment. Keep the file and check the deposit transaction.', simulated: false };
      } catch (error) { return { kind: 'indeterminate', reason: reason(error) }; }
    } },
    prover: { system: 'Groth16 / BN254', async prove({ note, pool, recipient }, onProgress, signal) {
      verifyNote(note, pool);
      signal.throwIfAborted();
      const s = await snapshot(pool);
      signal.throwIfAborted();
      const leaf = s.indices.get(note.commitment.toLowerCase());
      if (!leaf) throw Error('The note has no confirmed deposit on this pool.');
      if (await client.readContract({ address: address(pool), abi: poolAbi, functionName: 'spent', args: [note.nullifierHash] })) throw Error('This note is already spent.');
      return { payload: await proveWithdrawal(note, pool, recipient, s.tree, leaf.index, onProgress, signal), nullifierHash: note.nullifierHash, simulated: false };
    } },
    withdraw: {
      async gasPolicy() { return { kind: 'self-funded', simulated: false, estimate: { baseFeePerGas: null, gasLimit: null, totalWei: null, source: 'unavailable', detail: 'A connected wallet pays withdrawal gas. This publicly links that gas-paying wallet to the withdrawal. Use a separate funded wallet for privacy.' } }; },
      async submit(request, onPhase) {
        const proof = request.proof.payload as NativeProof | null;
        if (!proof || request.proof.simulated || proof.deploymentId !== DEPLOYMENT.id || proof.pool !== address(request.pool) || proof.recipient !== request.recipient || request.proof.nullifierHash !== request.note.nullifierHash) return { kind: 'not-sent', reason: 'The proof does not match this withdrawal. Generate it again.' };
        verifyNote(request.note, request.pool);
        onPhase({ kind: 'authorizing', label: 'Checking your proof and opening your wallet for gas' });
        const result = await send(request.pool, encodeFunctionData({ abi: poolAbi, functionName: 'withdraw', args: [proof.root, request.note.nullifierHash, request.recipient, proof.words] }), 0n);
        if (result.kind === 'submitted') {
          submitted.set(result.txHash, { pool: address(request.pool), event: 'Withdrawal', identity: request.note.nullifierHash, recipient: request.recipient });
          onPhase({ kind: 'submitted', label: 'Waiting for confirmation', txHash: result.txHash });
        }
        return result;
      },
    },
    reconcile: { check, async await(txHash, { timeoutMs, signal }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !signal?.aborted) {
        const result = await check(txHash);
        if (result.kind === 'confirmed' || result.kind === 'failed') return result;
        if (result.kind === 'unknown') return result;
        await sleep(3000);
      }
      return { kind: 'unknown', txHash, reason: 'Confirmation is taking longer than expected. Keep your note and recheck; do not resend yet.' };
    } },
  };
}
