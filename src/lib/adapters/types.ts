import type { Hex } from 'viem';
import type { PoolConfig } from '@/config/pool';
import type { PrivateNote } from '@/lib/note';

/**
 * The backend boundary. Six small adapters, one per thing the interface needs
 * from a chain. Everything simulated in this build is simulated here and
 * nowhere else, and every simulated value is tagged `simulated: true` so the
 * interface can never present it as real chain activity.
 */

/* -------------------------------------------------------------- account ---- */

export type AccountStatus = 'disconnected' | 'connecting' | 'connected';

export interface AccountState {
  readonly status: AccountStatus;
  readonly address: Hex | null;
  readonly chainId: number | null;
  readonly balanceWei: bigint | null;
  /** Wallet name for the account button, e.g. "MetaMask". */
  readonly providerLabel: string | null;
  /** Problem and recovery for a failed connect or chain switch. */
  readonly error: string | null;
  readonly simulated: boolean;
}

export interface AccountAdapter {
  getState(): AccountState;
  subscribe(listener: (state: AccountState) => void): () => void;
  /** Detect an already-authorized account without opening a wallet prompt. */
  resume(): Promise<void>;
  /** Called only from an explicit user action. May open a wallet prompt. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Ask the wallet to move to `chainId`, adding the chain if it is unknown. */
  switchChain(chainId: number): Promise<void>;
  refreshBalance(): Promise<void>;
}

/* ------------------------------------------------------------------ fees ---- */

export interface FeeEstimate {
  /** Live base fee per gas, when a chain read succeeded. */
  readonly baseFeePerGas: bigint | null;
  /** Gas units. Unknowable without a deployed contract to estimate against. */
  readonly gasLimit: bigint | null;
  /** baseFeePerGas × gasLimit, or null when either is unknown. */
  readonly totalWei: bigint | null;
  readonly source: 'live' | 'simulated' | 'unavailable';
  /** Why a value is missing, in the user's language. */
  readonly detail: string | null;
}

/* --------------------------------------------------------------- deposit ---- */

export interface DepositRequest {
  readonly pool: PoolConfig;
  readonly commitment: Hex;
  readonly from: Hex;
}

/** Deposit submission is four distinct states, never collapsed into one. */
export type DepositPhase =
  | { kind: 'signing'; label: string }
  | { kind: 'broadcasting'; label: string }
  | { kind: 'submitted'; label: string; txHash: Hex };

export type SubmissionResult =
  | { kind: 'submitted'; txHash: Hex; simulated: boolean }
  /** The wallet call failed before anything was broadcast. Nothing was sent. */
  | { kind: 'not-sent'; reason: string }
  /** Broadcast may or may not have happened. Never invite a retry from here. */
  | { kind: 'unknown'; reason: string; txHash: Hex | null };

export interface DepositAdapter {
  estimateFee(pool: PoolConfig): Promise<FeeEstimate>;
  submit(
    request: DepositRequest,
    onPhase: (phase: DepositPhase) => void,
  ): Promise<SubmissionResult>;
}

/* ------------------------------------------------------------ pool stats ---- */

/**
 * The anonymity set: how many other unspent notes of this exact denomination
 * a withdrawal could plausibly have come from. This is the number that decides
 * how private a withdrawal actually is, so the interface shows it where the
 * denomination is chosen rather than burying it in an explainer.
 */
export interface PoolStats {
  /** Unspent notes currently in the pool, including the user's own. */
  readonly anonymitySet: number;
  /** Epoch ms of the most recent deposit, or null when unknown. */
  readonly lastDepositAt: number | null;
  readonly simulated: boolean;
}

export interface PoolStatsAdapter {
  /** Resolves null when the pool genuinely cannot be read right now. */
  stats(pool: PoolConfig): Promise<PoolStats | null>;
}

/* ----------------------------------------------------------- note status ---- */

export type NoteStatus =
  /** Commitment is in the pool's tree and its nullifier is unspent. */
  | { kind: 'ready'; leafIndex: number; depositBlock: number; simulated: boolean }
  /** Deposit transaction has not been included yet. */
  | { kind: 'pending'; detail: string; simulated: boolean }
  /** Nullifier already published. The note controls nothing. */
  | { kind: 'spent'; spentTxHash: Hex | null; simulated: boolean }
  /** Status genuinely cannot be determined right now. Not a failure state. */
  | { kind: 'indeterminate'; reason: string };

export interface NoteStatusAdapter {
  check(note: PrivateNote, pool: PoolConfig): Promise<NoteStatus>;
}

/* ----------------------------------------------------------------- proof ---- */

export type ProofStage = 'artifacts' | 'witness' | 'proving' | 'verifying';

export interface ProofProgress {
  readonly stage: ProofStage;
  /** 0–1 when the stage reports progress, null when it cannot. */
  readonly fraction: number | null;
  readonly label: string;
}

export interface WithdrawalProof {
  /** Opaque to the interface. Shape belongs to the proof system. */
  readonly payload: unknown;
  readonly nullifierHash: Hex;
  readonly simulated: boolean;
}

export interface ProverAdapter {
  /** Proof system name, or null when no prover is wired. */
  readonly system: string | null;
  prove(
    input: { note: PrivateNote; pool: PoolConfig; recipient: Hex },
    onProgress: (progress: ProofProgress) => void,
    signal: AbortSignal,
  ): Promise<WithdrawalProof>;
}

/* ------------------------------------------------------------------- gas ---- */

/**
 * Who pays for the withdrawal. Shown only when it actually applies: a sponsor
 * is never advertised unless the backend reports one that is funded.
 */
export type GasPolicy =
  | { kind: 'sponsored'; sponsorRef: string; remainingLabel: string | null; simulated: boolean }
  | { kind: 'sponsor-depleted'; detail: string; simulated: boolean }
  | { kind: 'sponsor-offline'; detail: string; simulated: boolean }
  /** The recipient's own account pays. Requires a funded, connected account. */
  | { kind: 'self-funded'; estimate: FeeEstimate; simulated: boolean };

/* -------------------------------------------------------------- withdraw ---- */

export type WithdrawPhase =
  | { kind: 'authorizing'; label: string }
  | { kind: 'broadcasting'; label: string }
  | { kind: 'submitted'; label: string; txHash: Hex };

export interface WithdrawRequest {
  readonly note: PrivateNote;
  readonly pool: PoolConfig;
  readonly recipient: Hex;
  readonly proof: WithdrawalProof;
  readonly gas: GasPolicy;
}

export interface WithdrawAdapter {
  gasPolicy(pool: PoolConfig, account: AccountState): Promise<GasPolicy>;
  submit(
    request: WithdrawRequest,
    onPhase: (phase: WithdrawPhase) => void,
  ): Promise<SubmissionResult>;
}

/* ----------------------------------------------------------- reconcile ----- */

export type TxOutcome =
  | { kind: 'pending'; seenInMempool: boolean }
  | {
      kind: 'confirmed';
      txHash: Hex;
      blockNumber: number;
      gasUsed: bigint | null;
      simulated: boolean;
    }
  | { kind: 'failed'; reason: string; txHash: Hex }
  /**
   * The wait elapsed. The transaction may still confirm. Callers must present
   * this as an open question and must not offer a plain "try again".
   */
  | { kind: 'unknown'; reason: string; txHash: Hex | null };

export interface ReconcileAdapter {
  /** Resolves when the outcome is known, or with `unknown` after `timeoutMs`. */
  await(txHash: Hex, options: { timeoutMs: number; signal?: AbortSignal }): Promise<TxOutcome>;
  /** One-shot re-check, for a user-triggered reconciliation. */
  check(txHash: Hex): Promise<TxOutcome>;
}

/* ------------------------------------------------------------------ bundle -- */

export interface Backend {
  readonly kind: 'simulated' | 'chain';
  readonly account: AccountAdapter;
  readonly poolStats: PoolStatsAdapter;
  readonly deposit: DepositAdapter;
  readonly noteStatus: NoteStatusAdapter;
  readonly prover: ProverAdapter;
  readonly withdraw: WithdrawAdapter;
  readonly reconcile: ReconcileAdapter;
}
