import { numberToHex, type Hex } from 'viem';
import { decodeFrameTransaction, type FrameTx } from './frametx';

export const ALT_MEMPOOL = {
  chainId: 1337,
  genesisHash: '0x2ad3f67b059fbde111ad7af27cfb4955d997351579612237ca0318937a5bae7a',
  gateway: 'https://altmempoolgateway.forshtat.com/rpc',
  execution: 'https://altmempool.forshtat.com',
  explorer: 'https://explorer.altmempool.wtf',
} as const;

/** JSON shape consumed by the EF sidecar; empty recent roots are part of the signed envelope. */
export function frameToSidecar(tx: FrameTx) {
  if (tx.chainId !== BigInt(ALT_MEMPOOL.chainId)) throw Error('EF sidecar requires chain 1337');
  return {
    chainId: numberToHex(tx.chainId), nonceKeys: tx.nonceKeys.map(key => numberToHex(key)),
    nonceSeq: numberToHex(tx.nonceSeq), sender: tx.sender,
    frames: tx.frames.map(f => ({ mode: f.mode, flags: f.flags, target: f.target,
      limits: { execution: numberToHex(f.gasLimit), state: numberToHex(f.stateGasLimit) },
      value: numberToHex(f.value), data: f.data })),
    signatures: tx.signatures.map(s => ({ scheme: s.scheme, signer: s.signer ?? '0x', msg: s.msg, signature: s.signature })),
    fees: { maxPriorityFeePerGas: numberToHex(tx.maxPriorityFee), maxFeePerGas: numberToHex(tx.maxFee), maxFeePerBlobGas: numberToHex(tx.maxBlobFee) },
    blobVersionedHashes: [...tx.blobHashes], recentRootReferences: [],
  };
}
export interface SidecarRpc { request<T>(method: string, params: unknown[]): Promise<T> }
export async function submitToSidecar(rpc: SidecarRpc, raw: Hex): Promise<Hex> {
  const tx = decodeFrameTransaction(raw);
  let hash: Hex | undefined;
  for (let attempt = 0; attempt < 16; attempt++) {
    try { hash = await rpc.request<Hex>('eth_sendFrameTransaction', [frameToSidecar(tx)]); break; }
    catch (error) {
      if (error instanceof Error && error.message === 'Frame transaction already known') { hash = tx.transactionHash(); break; }
      if (!(error instanceof Error) || !error.message.includes('is already held by pending transaction') || attempt === 15) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!hash) throw Error('Sidecar did not acknowledge the transaction');
  if (hash.toLowerCase() !== tx.transactionHash()) throw Error('Sidecar returned another transaction hash');
  return hash;
}
