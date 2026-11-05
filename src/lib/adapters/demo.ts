'use client';

import type { Hex } from 'viem';
import { DEPLOYMENT, type PoolConfig } from '@/config/pool';
import type { PrivateNote } from '@/lib/note';
import type { ChainTransport } from '@/lib/transport/types';
import { demoAccountAdapter, resolveAccountAdapter, wait } from './account';
import { getScenario } from './scenario';
import type {
  AccountState,
  Backend,
  DepositAdapter,
  DepositPhase,
  DepositRequest,
  FeeEstimate,
  GasPolicy,
  NoteStatus,
  NoteStatusAdapter,
  ProofProgress,
  PoolStats,
  PoolStatsAdapter,
  ProverAdapter,
  ReconcileAdapter,
  SubmissionResult,
  TxOutcome,
  WithdrawAdapter,
  WithdrawPhase,
  WithdrawRequest,
  WithdrawalProof,
} from './types';

/**
 * Simulated backend. No contract is deployed and no proving artifacts exist in
 * this repo, so everything chain-facing is simulated here.
 *
 * Two rules this module keeps:
 *
 * 1. Every value it returns carries `simulated: true`.
 * 2. Simulated transaction references begin with four zero bytes, which a real
 *    hash essentially never does, so a stray reference cannot be mistaken for
 *    chain activity even outside the interface.
 */

/** In-memory session ledger. Cleared on reload; nothing is persisted. */
type LedgerEntry = {
  commitment: Hex;
  poolRef: string;
  txHash: Hex;
  state: 'pending' | 'confirmed' | 'failed';
  leafIndex: number;
  blockNumber: number;
  spentTxHash: Hex | null;
  confirmAt: number;
};

const ledger = new Map<Hex, LedgerEntry>();
let nextLeaf = 0;

function simulatedHash(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(28));
  const tail = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `0x00000000${tail}` as Hex;
}

/** A simulated reference, recognisable without any surrounding context. */
export function isSimulatedRef(hash: string): boolean {
  return hash.startsWith('0x00000000');
}

/* ------------------------------------------------------------ pool stats ---- */

/**
 * Simulated anonymity sets. Deliberately uneven across denominations, because
 * that is what a real pool looks like and it is the whole reason the number is
 * worth showing: the cheapest pool is not always the most private one.
 */
const BASE_SET: Record<string, number> = {
  'eth-0.01': 412,
  'eth-0.1': 1284,
  'eth-1': 196,
  'eth-10': 23,
};

function poolStatsAdapter(): PoolStatsAdapter {
  return {
    async stats(pool: PoolConfig): Promise<PoolStats | null> {
      await wait(280);
      if (getScenario() === 'note-indeterminate') return null;
      const deposited = [...ledger.values()].filter(
        (e) => e.poolRef === pool.ref && e.state === 'confirmed' && !e.spentTxHash,
      );
      const last = deposited.at(-1);
      return {
        anonymitySet: (BASE_SET[pool.ref] ?? 0) + deposited.length,
        lastDepositAt: last ? Date.now() - 1000 * 60 * 7 : null,
        simulated: true,
      };
    },
  };
}

/* --------------------------------------------------------------- deposit ---- */

function depositAdapter(transport: ChainTransport): DepositAdapter {
  return {
    async estimateFee(): Promise<FeeEstimate> {
      // The gas price is a real chain read, routed through the anonymizing
      // network. Gas units are not knowable without a deployed contract to
      // estimate against, so the total stays unknown rather than invented.
      try {
        const baseFeePerGas = BigInt(await transport.request<string>('eth_gasPrice'));
        return {
          baseFeePerGas,
          gasLimit: null,
          totalWei: null,
          source: 'live',
          detail:
            'Live gas price, read anonymously. The total also needs a deployed pool contract to estimate gas against, and none is deployed in this build.',
        };
      } catch {
        // Transport problems belong in the read-path panel, not in this row.
        return {
          baseFeePerGas: null,
          gasLimit: null,
          totalWei: null,
          source: 'unavailable',
          detail: 'A live gas price needs the read path, which is not connected yet.',
        };
      }
    },

    async submit(
      request: DepositRequest,
      onPhase: (phase: DepositPhase) => void,
    ): Promise<SubmissionResult> {
      onPhase({ kind: 'signing', label: 'Waiting for your wallet to sign' });
      await wait(900);

      if (getScenario() === 'deposit-not-sent')
        return {
          kind: 'not-sent',
          reason:
            'Your wallet declined the deposit. Nothing was sent and no funds moved. Your note is still valid — submit it again when you are ready.',
        };

      onPhase({ kind: 'broadcasting', label: 'Broadcasting the deposit' });
      await wait(700);

      const txHash = simulatedHash();

      if (getScenario() === 'deposit-unknown')
        return {
          kind: 'unknown',
          txHash,
          reason:
            'The deposit was signed and broadcast, but the network did not acknowledge it in time. It may still confirm.',
        };

      ledger.set(request.commitment, {
        commitment: request.commitment,
        poolRef: request.pool.ref,
        txHash,
        state: 'pending',
        leafIndex: nextLeaf++,
        blockNumber: 0,
        spentTxHash: null,
        confirmAt: Date.now() + 3200,
      });

      onPhase({ kind: 'submitted', label: 'Waiting for confirmation', txHash });
      return { kind: 'submitted', txHash, simulated: true };
    },
  };
}

/* ----------------------------------------------------------- note status ---- */

function noteStatusAdapter(): NoteStatusAdapter {
  return {
    async check(note: PrivateNote, pool: PoolConfig): Promise<NoteStatus> {
      await wait(650);
      const scenario = getScenario();

      if (scenario === 'note-indeterminate')
        return {
          kind: 'indeterminate',
          reason:
            'The pool could not be read just now, so this note cannot be checked. Your note is unaffected — retry in a moment.',
        };

      if (scenario === 'note-spent')
        return { kind: 'spent', spentTxHash: simulatedHash(), simulated: true };

      if (scenario === 'note-pending')
        return {
          kind: 'pending',
          detail: 'The deposit for this note has not been included in a block yet.',
          simulated: true,
        };

      const entry = ledger.get(note.commitment);
      if (!entry || entry.poolRef !== pool.ref)
        return {
          kind: 'pending',
          detail:
            'No deposit for this note has been seen in this session. In Demo mode the pool is in-memory, so deposit a note here first, or switch to a Note scenario in the Demo mode panel.',
          simulated: true,
        };

      if (entry.spentTxHash)
        return { kind: 'spent', spentTxHash: entry.spentTxHash, simulated: true };

      if (entry.state !== 'confirmed')
        return {
          kind: 'pending',
          detail: 'The deposit for this note has not confirmed yet.',
          simulated: true,
        };

      return {
        kind: 'ready',
        leafIndex: entry.leafIndex,
        depositBlock: entry.blockNumber,
        simulated: true,
      };
    },
  };
}

/* ----------------------------------------------------------------- proof ---- */

const PROOF_STEPS: { stage: ProofProgress['stage']; label: string; ms: number }[] = [
  { stage: 'artifacts', label: 'Loading proving artifacts', ms: 900 },
  { stage: 'witness', label: 'Building the witness from your note', ms: 1500 },
  { stage: 'proving', label: 'Generating the proof in this browser', ms: 2600 },
  { stage: 'verifying', label: 'Checking the proof locally', ms: 700 },
];

function proverAdapter(): ProverAdapter {
  return {
    system: null,
    async prove(input, onProgress, signal): Promise<WithdrawalProof> {
      for (const step of PROOF_STEPS) {
        const ticks = Math.max(1, Math.round(step.ms / 110));
        for (let i = 0; i < ticks; i++) {
          if (signal.aborted) throw new DOMException('Proof generation cancelled', 'AbortError');
          await wait(110);
          onProgress({ stage: step.stage, fraction: (i + 1) / ticks, label: step.label });
        }
        if (step.stage === 'proving' && getScenario() === 'proof-failed')
          throw new Error(
            'Proof generation failed while building the proof. Your note was not used and no transaction was sent. Try again — if it keeps failing, the proving artifacts for this pool may be out of date.',
          );
      }
      return { payload: { simulated: true }, nullifierHash: input.note.nullifierHash, simulated: true };
    },
  };
}

/* -------------------------------------------------------------- withdraw ---- */

function withdrawAdapter(): WithdrawAdapter {
  return {
    async gasPolicy(_pool: PoolConfig, account: AccountState): Promise<GasPolicy> {
      await wait(400);
      const scenario = getScenario();

      if (scenario === 'sponsor-depleted')
        return {
          kind: 'sponsor-depleted',
          detail:
            'The gas sponsor for this pool has run out of funds, so it cannot pay for your withdrawal right now.',
          simulated: true,
        };

      if (scenario === 'sponsor-offline')
        return {
          kind: 'sponsor-offline',
          detail:
            'The gas sponsor for this pool could not be reached, so whether it can pay is unknown.',
          simulated: true,
        };

      if (account.status === 'connected')
        return {
          kind: 'self-funded',
          simulated: true,
          estimate: {
            baseFeePerGas: null,
            gasLimit: null,
            totalWei: null,
            source: 'unavailable',
            detail:
              'A gas estimate needs a deployed pool contract. None is deployed in this build.',
          },
        };

      return {
        kind: 'sponsored',
        sponsorRef: 'Simulated sponsor',
        remainingLabel: null,
        simulated: true,
      };
    },

    async submit(
      request: WithdrawRequest,
      onPhase: (phase: WithdrawPhase) => void,
    ): Promise<SubmissionResult> {
      onPhase({ kind: 'authorizing', label: 'Authorizing the spend' });
      await wait(800);
      onPhase({ kind: 'broadcasting', label: 'Broadcasting the withdrawal' });
      await wait(900);

      const txHash = simulatedHash();

      if (getScenario() === 'withdraw-unknown')
        return {
          kind: 'unknown',
          txHash,
          reason:
            'The withdrawal was broadcast, but the network did not acknowledge it in time. It may still confirm.',
        };

      const entry = ledger.get(request.note.commitment);
      if (entry) entry.spentTxHash = txHash;

      onPhase({ kind: 'submitted', label: 'Waiting for confirmation', txHash });
      return { kind: 'submitted', txHash, simulated: true };
    },
  };
}

/* ------------------------------------------------------------- reconcile ---- */

function reconcileAdapter(): ReconcileAdapter {
  const started = new Map<Hex, number>();

  function outcome(txHash: Hex): TxOutcome {
    const scenario = getScenario();
    const first = started.get(txHash) ?? Date.now();
    started.set(txHash, first);
    const elapsed = Date.now() - first;

    if (elapsed < 2800) return { kind: 'pending', seenInMempool: elapsed > 700 };

    if (scenario === 'deposit-failed' || scenario === 'withdraw-failed')
      return {
        kind: 'failed',
        txHash,
        reason: 'The transaction was included but reverted. No funds moved and no gas was refunded.',
      };

    const entry = [...ledger.values()].find((e) => e.txHash === txHash || e.spentTxHash === txHash);
    if (entry && entry.txHash === txHash) {
      entry.state = 'confirmed';
      entry.blockNumber = entry.blockNumber || 7_200_000 + entry.leafIndex;
    }

    return {
      kind: 'confirmed',
      txHash,
      blockNumber: entry?.blockNumber ?? 7_200_000,
      gasUsed: null,
      simulated: true,
    };
  }

  return {
    async check(txHash) {
      await wait(500);
      return outcome(txHash);
    },

    async await(txHash, { timeoutMs, signal }) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (signal?.aborted) return { kind: 'pending', seenInMempool: true };
        const result = outcome(txHash);
        if (result.kind !== 'pending') return result;
        if (Date.now() > deadline)
          return {
            kind: 'unknown',
            txHash,
            reason: `No confirmation after ${Math.round(timeoutMs / 1000)} seconds. The transaction may still confirm.`,
          };
        await wait(600);
      }
    },
  };
}

export function demoBackend(transport: ChainTransport): Backend {
  return {
    kind: 'demo',
    // A real wallet is used when the browser has one: address, network and
    // balance are live even though submission is simulated.
    account: typeof window === 'undefined' ? demoAccountAdapter() : resolveAccountAdapter(),
    poolStats: poolStatsAdapter(),
    deposit: depositAdapter(transport),
    noteStatus: noteStatusAdapter(),
    prover: proverAdapter(),
    withdraw: withdrawAdapter(),
    reconcile: reconcileAdapter(),
  };
}

export const DEMO_CHAIN_LABEL = `${DEPLOYMENT.chainName} · simulated pool`;
