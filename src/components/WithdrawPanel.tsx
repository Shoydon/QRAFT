'use client';

import { useId, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { DEPLOYMENT, type PoolConfig } from '@/config/pool';
import { formatEth, checkRecipient, truncateMiddle } from '@/lib/format';
import { noteHandle, parseNote, type NoteParseError, type PrivateNote } from '@/lib/note';
import type {
  AccountState,
  Backend,
  GasPolicy,
  NoteStatus,
  ProofProgress,
  TxOutcome,
  WithdrawPhase,
  WithdrawalProof,
} from '@/lib/adapters/types';
import { Button, Card, Hero, Mono, Notice, Rail, Row, RowGroup, StatusLine, type Tone } from './primitives';
import { Disclosure } from './Disclosure';
import { StepRail } from './StepRail';
import { TxRef, TxRefHint } from './TxRef';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClipboardIcon,
  FileIcon,
  RetryIcon,
  WalletIcon,
} from './icons';

const STEPS = ['Note', 'Recipient', 'Prove', 'Receipt'] as const;

type Loaded = { note: PrivateNote; pool: PoolConfig };

type Stage =
  | { k: 'import' }
  | { k: 'checking'; loaded: Loaded }
  | { k: 'status'; loaded: Loaded; status: NoteStatus }
  | { k: 'recipient'; loaded: Loaded; status: Extract<NoteStatus, { kind: 'ready' }> }
  | { k: 'review'; loaded: Loaded; recipient: Hex; gas: GasPolicy | null }
  | { k: 'proving'; loaded: Loaded; recipient: Hex; gas: GasPolicy; progress: ProofProgress }
  | { k: 'proof-failed'; loaded: Loaded; recipient: Hex; gas: GasPolicy; reason: string }
  | { k: 'submitting'; loaded: Loaded; recipient: Hex; phase: WithdrawPhase }
  | { k: 'confirming'; loaded: Loaded; recipient: Hex; txHash: Hex }
  | { k: 'receipt'; loaded: Loaded; recipient: Hex; outcome: Extract<TxOutcome, { kind: 'confirmed' }> }
  | { k: 'not-sent'; loaded: Loaded; recipient: Hex; reason: string }
  | { k: 'failed'; loaded: Loaded; recipient: Hex; txHash: Hex; reason: string }
  | { k: 'unknown'; loaded: Loaded; recipient: Hex; txHash: Hex | null; reason: string };

function stepOf(s: Stage): number {
  if (s.k === 'import' || s.k === 'checking' || s.k === 'status') return 0;
  if (s.k === 'recipient') return 1;
  if (s.k === 'receipt') return 3;
  return 2;
}

export function WithdrawPanel({
  backend,
  account,
}: {
  backend: Backend | null;
  account: AccountState;
}) {
  const [stage, setStage] = useState<Stage>({ k: 'import' });
  const abort = useRef<AbortController | null>(null);

  async function loadNote(text: string): Promise<NoteParseError | null> {
    const parsed = parseNote(text);
    if (!parsed.ok) return parsed.error;
    const loaded: Loaded = { note: parsed.note, pool: parsed.pool };
    setStage({ k: 'checking', loaded });
    const status = (await backend?.noteStatus.check(parsed.note, parsed.pool)) ?? {
      kind: 'indeterminate' as const,
      reason: 'The pool cannot be read yet. Try again in a moment.',
    };
    if (status.kind === 'ready') setStage({ k: 'recipient', loaded, status });
    else setStage({ k: 'status', loaded, status });
    return null;
  }

  async function recheck(loaded: Loaded) {
    setStage({ k: 'checking', loaded });
    const status = (await backend?.noteStatus.check(loaded.note, loaded.pool)) ?? {
      kind: 'indeterminate' as const,
      reason: 'The pool cannot be read yet.',
    };
    if (status.kind === 'ready') setStage({ k: 'recipient', loaded, status });
    else setStage({ k: 'status', loaded, status });
  }

  async function openReview(loaded: Loaded, recipient: Hex) {
    setStage({ k: 'review', loaded, recipient, gas: null });
    const gas = await backend?.withdraw.gasPolicy(loaded.pool, account);
    if (gas) setStage({ k: 'review', loaded, recipient, gas });
  }

  async function run(loaded: Loaded, recipient: Hex, gas: GasPolicy) {
    if (!backend) return;
    const controller = new AbortController();
    abort.current = controller;

    let proof: WithdrawalProof;
    try {
      setStage({
        k: 'proving',
        loaded,
        recipient,
        gas,
        progress: { stage: 'artifacts', fraction: null, label: 'Preparing' },
      });
      proof = await backend.prover.prove(
        { note: loaded.note, pool: loaded.pool, recipient },
        (progress) => setStage({ k: 'proving', loaded, recipient, gas, progress }),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setStage({ k: 'recipient', loaded, status: { kind: 'ready', leafIndex: 0, depositBlock: 0, simulated: true } });
        return;
      }
      setStage({
        k: 'proof-failed',
        loaded,
        recipient,
        gas,
        reason: error instanceof Error ? error.message : 'Proof generation failed.',
      });
      return;
    }

    setStage({
      k: 'submitting',
      loaded,
      recipient,
      phase: { kind: 'authorizing', label: 'Authorizing the spend' },
    });

    const result = await backend.withdraw.submit(
      { note: loaded.note, pool: loaded.pool, recipient, proof, gas },
      (phase) => setStage({ k: 'submitting', loaded, recipient, phase }),
    );

    if (result.kind === 'not-sent') {
      setStage({ k: 'not-sent', loaded, recipient, reason: result.reason });
      return;
    }
    if (result.kind === 'unknown') {
      setStage({ k: 'unknown', loaded, recipient, txHash: result.txHash, reason: result.reason });
      return;
    }

    setStage({ k: 'confirming', loaded, recipient, txHash: result.txHash });
    const outcome = await backend.reconcile.await(result.txHash, { timeoutMs: 45_000 });
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', loaded, recipient, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', loaded, recipient, txHash: result.txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', loaded, recipient, txHash: result.txHash, reason: outcome.reason });
  }

  async function recheckTx(loaded: Loaded, recipient: Hex, txHash: Hex) {
    if (!backend) return;
    const outcome = await backend.reconcile.check(txHash);
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', loaded, recipient, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', loaded, recipient, txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', loaded, recipient, txHash, reason: outcome.reason });
  }

  return (
    <Card as="section" className="overflow-hidden">
      <div className="border-b border-rule px-5 pb-4 pt-5 sm:px-6">
        <StepRail steps={STEPS} current={stepOf(stage)} />
      </div>

      <div aria-live="polite" className="sr-only">
        {stage.k === 'proving' ? stage.progress.label : null}
        {stage.k === 'receipt' ? 'Withdrawal confirmed' : null}
      </div>

      <div key={stage.k} className="step-enter p-5 sm:p-6">
        {stage.k === 'import' ? <ImportStep onLoad={loadNote} /> : null}

        {stage.k === 'checking' ? <CheckingStep loaded={stage.loaded} /> : null}

        {stage.k === 'status' ? (
          <StatusStep
            loaded={stage.loaded}
            status={stage.status}
            onRetry={() => void recheck(stage.loaded)}
            onReset={() => setStage({ k: 'import' })}
          />
        ) : null}

        {stage.k === 'recipient' ? (
          <RecipientStep
            loaded={stage.loaded}
            onBack={() => setStage({ k: 'import' })}
            onNext={(recipient) => void openReview(stage.loaded, recipient)}
          />
        ) : null}

        {stage.k === 'review' ? (
          <ReviewStep
            loaded={stage.loaded}
            recipient={stage.recipient}
            gas={stage.gas}
            account={account}
            backend={backend}
            onBack={() =>
              setStage({
                k: 'recipient',
                loaded: stage.loaded,
                status: { kind: 'ready', leafIndex: 0, depositBlock: 0, simulated: true },
              })
            }
            onGo={(gas) => void run(stage.loaded, stage.recipient, gas)}
          />
        ) : null}

        {stage.k === 'proving' ? (
          <ProvingStep
            loaded={stage.loaded}
            progress={stage.progress}
            system={backend?.prover.system ?? null}
            onCancel={() => abort.current?.abort()}
          />
        ) : null}

        {stage.k === 'proof-failed' ? (
          <Outcome
            tone="bad"
            badge="Not completed"
            title="The proof could not be generated"
            reason={stage.reason}
            loaded={stage.loaded}
            recipient={stage.recipient}
            primary={{
              label: 'Try again',
              icon: 'retry',
              onClick: () => void run(stage.loaded, stage.recipient, stage.gas),
            }}
            secondary={{ label: 'Use a different note', onClick: () => setStage({ k: 'import' }) }}
          />
        ) : null}

        {stage.k === 'submitting' ? (
          <SubmittingStep loaded={stage.loaded} recipient={stage.recipient} phase={stage.phase} />
        ) : null}

        {stage.k === 'confirming' ? (
          <ConfirmingStep loaded={stage.loaded} recipient={stage.recipient} txHash={stage.txHash} />
        ) : null}

        {stage.k === 'receipt' ? (
          <ReceiptStep
            loaded={stage.loaded}
            recipient={stage.recipient}
            outcome={stage.outcome}
            onDone={() => setStage({ k: 'import' })}
          />
        ) : null}

        {stage.k === 'not-sent' ? (
          <Outcome
            tone="bad"
            badge="Nothing was sent"
            title="The withdrawal was not submitted"
            reason={`${stage.reason} Your note is unspent and can still be used.`}
            loaded={stage.loaded}
            recipient={stage.recipient}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'import' }) }}
          />
        ) : null}

        {stage.k === 'failed' ? (
          <Outcome
            tone="bad"
            badge="Reverted"
            title="The withdrawal did not go through"
            reason={`${stage.reason} Your note has not been marked spent.`}
            loaded={stage.loaded}
            recipient={stage.recipient}
            txHash={stage.txHash}
            primary={{
              label: 'Check the note again',
              icon: 'retry',
              onClick: () => void recheck(stage.loaded),
            }}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'import' }) }}
          />
        ) : null}

        {stage.k === 'unknown' ? (
          <Outcome
            tone="unknown"
            badge="Not yet known"
            title="Outcome unknown"
            reason={`${stage.reason} Until it is resolved, do not submit this note again: a second attempt that lands after the first would be rejected, and until then the note's status cannot be trusted either way.`}
            loaded={stage.loaded}
            recipient={stage.recipient}
            txHash={stage.txHash ?? undefined}
            primary={
              stage.txHash
                ? {
                    label: 'Check again',
                    icon: 'retry',
                    onClick: () => void recheckTx(stage.loaded, stage.recipient, stage.txHash as Hex),
                  }
                : undefined
            }
            secondary={{ label: 'Leave this pending', onClick: () => setStage({ k: 'import' }) }}
          />
        ) : null}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- import ---- */

function ImportStep({ onLoad }: { onLoad: (text: string) => Promise<NoteParseError | null> }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<NoteParseError | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  async function submit(value: string) {
    setBusy(true);
    setError(await onLoad(value));
    setBusy(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 8192) {
      setError({
        code: 'too-long',
        message: 'That file is too large to be a note. Choose the note file you downloaded.',
      });
      return;
    }
    // Read locally. The file never leaves this browser.
    await submit(await file.text());
  }

  return (
    <>
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.025em]">Import your note</h2>
      <p className="mt-1.5 max-w-[48ch] text-[0.8125rem] leading-[1.55] text-ink-60">
        Your note is read in this browser and held in memory only. No wallet is needed for this step,
        or for generating the proof.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept=".txt,text/plain"
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Button
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        icon={<FileIcon width={17} height={17} />}
        busy={busy}
        onClick={() => fileInput.current?.click()}
      >
        Choose note file
      </Button>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-rule" />
        <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-45">
          or paste it
        </span>
        <span className="h-px flex-1 bg-rule" />
      </div>

      <label htmlFor={fieldId} className="sr-only">
        Note text
      </label>
      <textarea
        id={fieldId}
        value={text}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        placeholder="project-note-v1:…"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`w-full resize-none rounded-control border bg-surface p-3 font-mono text-[0.8125rem] leading-[1.6] text-ink transition-colors placeholder:text-ink-60 ${
          error ? 'border-state-bad/50' : 'border-rule-strong focus:border-ink'
        }`}
      />

      {error ? (
        <p
          id={`${fieldId}-error`}
          className="mt-2 flex gap-2 text-[0.8125rem] leading-[1.5] text-state-bad"
          role="alert"
        >
          <span className="mt-[7px] size-[6px] shrink-0 rounded-full bg-state-bad" />
          {error.message}
        </p>
      ) : null}

      <Button
        variant="secondary"
        className="mt-3 w-full"
        icon={<ClipboardIcon width={16} height={16} />}
        disabled={!text.trim()}
        busy={busy}
        onClick={() => void submit(text)}
      >
        Use pasted note
      </Button>
    </>
  );
}

/* ------------------------------------------------------------ note status ---- */

function NoteFacts({
  loaded,
  summary,
  children,
}: {
  loaded: Loaded;
  summary?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <Disclosure label="Note details" summary={summary}>
        <RowGroup>
          <Row label="Denomination">{formatEth(loaded.pool.denominationWei)} ETH</Row>
          <Row label="Pool">
            {DEPLOYMENT.chainName} · {loaded.pool.label}
          </Row>
          <Row label="Note">
            <Mono>{noteHandle(loaded.note)}</Mono>
          </Row>
          {children}
        </RowGroup>
      </Disclosure>
    </div>
  );
}

function CheckingStep({ loaded }: { loaded: Loaded }) {
  return (
    <div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption="Checking this note"
        tone="pending"
      />
      <div className="mt-6">
        <Rail fraction={null} label="Checking the note" />
      </div>
      <p className="mt-3 text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        Reading the pool to see whether the deposit is included and the note is still unspent.
      </p>
    </div>
  );
}

const STATUS_VIEW: Record<
  Exclude<NoteStatus['kind'], 'ready'>,
  { tone: Tone; badge: string; title: string }
> = {
  pending: { tone: 'pending', badge: 'Pending', title: 'This deposit has not confirmed yet' },
  spent: { tone: 'spent', badge: 'Spent', title: 'This note has already been withdrawn' },
  indeterminate: { tone: 'unknown', badge: 'Unknown', title: 'This note cannot be checked right now' },
};

function StatusStep({
  loaded,
  status,
  onRetry,
  onReset,
}: {
  loaded: Loaded;
  status: NoteStatus;
  onRetry: () => void;
  onReset: () => void;
}) {
  if (status.kind === 'ready') return null;
  const view = STATUS_VIEW[status.kind];
  const detail =
    status.kind === 'pending'
      ? status.detail
      : status.kind === 'indeterminate'
        ? status.reason
        : 'The nullifier for this note is already published onchain, so it no longer controls any funds. If you did not withdraw it, someone with a copy of the file did.';

  return (
    <div>
      <div className="flex justify-center">
        <StatusLine tone={view.tone} pulse={status.kind === 'pending'}>
          {view.badge}
        </StatusLine>
      </div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption={view.title}
        tone={view.tone}
      />
      <p className="mx-auto mt-4 max-w-[46ch] text-center text-[0.8125rem] leading-[1.55] text-ink-80">
        {detail}
      </p>

      <NoteFacts loaded={loaded} summary={view.badge}>
        {status.kind === 'spent' && status.spentTxHash ? (
          <Row label="Spent in" hint={<TxRefHint simulated={status.simulated} />}>
            <TxRef hash={status.spentTxHash} simulated={status.simulated} />
          </Row>
        ) : null}
      </NoteFacts>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {status.kind !== 'spent' ? (
          <Button
            variant="primary"
            className="flex-1"
            icon={<RetryIcon width={16} height={16} />}
            onClick={onRetry}
          >
            Check again
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className={status.kind === 'spent' ? 'flex-1' : ''}
          onClick={onReset}
        >
          Use a different note
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- recipient ---- */

function RecipientStep({
  loaded,
  onBack,
  onNext,
}: {
  loaded: Loaded;
  onBack: () => void;
  onNext: (recipient: Hex) => void;
}) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const fieldId = useId();
  const check = checkRecipient(value);
  const showError = touched && value.trim().length > 0 && !check.ok;

  return (
    <>
      <div className="flex justify-center">
        <StatusLine tone="good">Ready to withdraw</StatusLine>
      </div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption="Where should it go?"
      />

      <div className="mt-6">
        <label htmlFor={fieldId} className="block text-[0.8125rem] font-medium text-ink">
          Recipient address
        </label>
        <input
          id={fieldId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          placeholder="0x…"
          aria-invalid={showError ? true : undefined}
          aria-describedby={showError ? `${fieldId}-error` : `${fieldId}-hint`}
          className={`mt-1.5 h-12 w-full rounded-control border bg-surface px-3.5 font-mono text-[0.875rem] text-ink transition-colors placeholder:text-ink-60 ${
            showError ? 'border-state-bad/50' : 'border-rule-strong focus:border-ink'
          }`}
          data-numeric
        />
        {showError ? (
          <p
            id={`${fieldId}-error`}
            className="mt-2 flex gap-2 text-[0.8125rem] leading-[1.5] text-state-bad"
            role="alert"
          >
            <span className="mt-[7px] size-[6px] shrink-0 rounded-full bg-state-bad" />
            {check.ok ? '' : check.reason}
          </p>
        ) : (
          <p id={`${fieldId}-hint`} className="mt-2 text-[0.75rem] leading-snug text-ink-60">
            {check.ok
              ? check.checksummed
                ? 'Valid address, checksum verified.'
                : 'Valid address. It is all lowercase, so there is no checksum to verify — double-check it.'
              : 'Use an address with no public link to the wallet that funded the deposit.'}
          </p>
        )}
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" icon={<ArrowLeftIcon width={17} height={17} />} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!check.ok}
          iconAfter={<ArrowRightIcon width={17} height={17} />}
          onClick={() => check.ok && onNext(check.address)}
        >
          Review withdrawal
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- review ---- */

function GasRow({ gas }: { gas: GasPolicy }) {
  if (gas.kind === 'sponsored')
    return (
      <Row
        label="Gas"
        hint={`Paid by ${gas.sponsorRef}${gas.remainingLabel ? ` · ${gas.remainingLabel}` : ''}. You do not need a wallet or ETH.`}
      >
        Sponsored
      </Row>
    );
  if (gas.kind === 'self-funded')
    return (
      <Row label="Gas" hint={gas.estimate.detail ?? 'Paid from your connected wallet.'}>
        {gas.estimate.totalWei === null ? 'Your wallet pays' : `${formatEth(gas.estimate.totalWei)} ETH`}
      </Row>
    );
  return (
    <Row label="Gas" hint={gas.detail}>
      <span className="text-state-bad">Sponsor unavailable</span>
    </Row>
  );
}

function ReviewStep({
  loaded,
  recipient,
  gas,
  account,
  backend,
  onBack,
  onGo,
}: {
  loaded: Loaded;
  recipient: Hex;
  gas: GasPolicy | null;
  account: AccountState;
  backend: Backend | null;
  onBack: () => void;
  onGo: (gas: GasPolicy) => void;
}) {
  const sponsorBroken = gas?.kind === 'sponsor-depleted' || gas?.kind === 'sponsor-offline';
  const needsWallet = sponsorBroken && account.status !== 'connected';
  const canGo = gas !== null && !needsWallet;

  return (
    <>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption={
          <>
            to{' '}
            <span className="font-mono text-ink" data-numeric>
              {truncateMiddle(recipient, 10, 8)}
            </span>
          </>
        }
      />
      <p className="mx-auto mt-4 max-w-[46ch] text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        Check the recipient carefully. Once this is confirmed it cannot be reversed or redirected.
      </p>

      <div className="mt-5">
        <Disclosure
          label="Recipient and gas"
          summary={
            gas === null
              ? 'Checking…'
              : gas.kind === 'sponsored'
                ? 'Gas sponsored'
                : gas.kind === 'self-funded'
                  ? 'You pay gas'
                  : 'Sponsor unavailable'
          }
        >
          <RowGroup>
            <Row label="Amount">{formatEth(loaded.pool.denominationWei)} ETH</Row>
            <Row label="Recipient">
              <span className="font-mono">{truncateMiddle(recipient, 12, 10)}</span>
            </Row>
            <Row label="Pool">
              {DEPLOYMENT.chainName} · {loaded.pool.label}
            </Row>
            {gas === null ? <Row label="Gas">Checking…</Row> : <GasRow gas={gas} />}
          </RowGroup>
        </Disclosure>
      </div>

      {sponsorBroken ? (
        <div className="mt-5">
          <Notice
            tone="bad"
            title={gas.kind === 'sponsor-depleted' ? 'The gas sponsor is out of funds' : 'The gas sponsor is unreachable'}
            action={
              account.status === 'connected' ? undefined : (
                <Button
                  variant="primary"
                  icon={<WalletIcon width={16} height={16} />}
                  busy={account.status === 'connecting'}
                  onClick={() => void backend?.account.connect()}
                >
                  Connect a wallet to pay gas
                </Button>
              )
            }
          >
            {gas.detail} To continue now, connect a wallet with enough ETH to pay the gas yourself —
            note that this publicly links that wallet to this withdrawal, though not to your
            deposit. Otherwise, come back later: your note stays valid.
          </Notice>
        </div>
      ) : null}

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" icon={<ArrowLeftIcon width={17} height={17} />} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!canGo}
          onClick={() => gas && onGo(gas)}
        >
          Generate proof and withdraw
        </Button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- prove ---- */

const PROOF_STAGES: { id: ProofProgress['stage']; label: string }[] = [
  { id: 'artifacts', label: 'Proving artifacts' },
  { id: 'witness', label: 'Witness' },
  { id: 'proving', label: 'Proof' },
  { id: 'verifying', label: 'Local check' },
];

function ProvingStep({
  loaded,
  progress,
  system,
  onCancel,
}: {
  loaded: Loaded;
  progress: ProofProgress;
  system: string | null;
  onCancel: () => void;
}) {
  const index = PROOF_STAGES.findIndex((s) => s.id === progress.stage);
  const overall = (index + (progress.fraction ?? 0)) / PROOF_STAGES.length;

  return (
    <div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption="Generating your proof"
        tone="pending"
      />

      <div className="mt-6">
        <Rail fraction={overall} label={progress.label} />
        <p className="mt-2.5 text-center text-[0.8125rem] font-medium text-ink">{progress.label}</p>
      </div>

      <p className="mx-auto mt-4 max-w-[46ch] text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        This runs entirely on your device, so it takes a moment. Your note is not sent anywhere —
        the proof shows that some valid unspent note exists, without revealing which one.
      </p>

      <ol className="mt-5 space-y-2">
        {PROOF_STAGES.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2.5 text-[0.8125rem]">
            <StatusLine tone={i < index ? 'good' : i === index ? 'pending' : 'neutral'} pulse={i === index}>
              <span className={i <= index ? 'text-ink-80' : 'text-ink-45'}>{s.label}</span>
            </StatusLine>
          </li>
        ))}
      </ol>

      <div className="mt-5">
        <Disclosure label="Proof" summary={system ?? 'Simulated'}>
          <RowGroup>
            <Row label="Withdrawing">{formatEth(loaded.pool.denominationWei)} ETH</Row>
            <Row
              label="Proof system"
              hint={
                system ? undefined : 'No prover is wired in this build, so this progress is simulated.'
              }
            >
              {system ?? 'Simulated'}
            </Row>
          </RowGroup>
        </Disclosure>
      </div>

      <div className="mt-4 flex justify-center">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- submit / receipt ---- */

const WITHDRAW_PHASE_COPY: Record<WithdrawPhase['kind'], string> = {
  authorizing: 'Authorizing the spend with your proof. Nothing has been broadcast yet.',
  broadcasting: 'Sending the withdrawal to the network.',
  submitted: 'Submitted. Waiting for a block to include it.',
};

function SubmittingStep({
  loaded,
  recipient,
  phase,
}: {
  loaded: Loaded;
  recipient: Hex;
  phase: WithdrawPhase;
}) {
  return (
    <div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption={phase.label}
        tone="pending"
      />
      <div className="mt-6">
        <Rail fraction={null} label={phase.label} />
      </div>
      <p className="mt-3 text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        {WITHDRAW_PHASE_COPY[phase.kind]}
      </p>
      <div className="mt-5">
        <Disclosure label="Withdrawal" summary="Note not yet spent">
          <RowGroup>
            <Row label="Amount">{formatEth(loaded.pool.denominationWei)} ETH</Row>
            <Row label="Recipient">
              <span className="font-mono">{truncateMiddle(recipient, 12, 10)}</span>
            </Row>
            <Row label="Note">Not yet spent</Row>
          </RowGroup>
        </Disclosure>
      </div>
    </div>
  );
}

function ConfirmingStep({
  loaded,
  recipient,
  txHash,
}: {
  loaded: Loaded;
  recipient: Hex;
  txHash: Hex;
}) {
  return (
    <div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption="Waiting for confirmation"
        tone="pending"
      />
      <div className="mt-6">
        <Rail fraction={null} label="Waiting for confirmation" />
      </div>
      <p className="mx-auto mt-3 max-w-[46ch] text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        The note is only spent once a block includes this transaction. Keep your note file until
        then.
      </p>
      <div className="mt-5">
        <Disclosure label="Transaction" summary="Pending">
          <RowGroup>
            <Row label="Recipient">
              <span className="font-mono">{truncateMiddle(recipient, 12, 10)}</span>
            </Row>
            <Row label="Reference" hint={<TxRefHint simulated />}>
              <TxRef hash={txHash} simulated />
            </Row>
            <Row label="Note">
              <StatusLine tone="pending" pulse>
                Not spent until confirmed
              </StatusLine>
            </Row>
          </RowGroup>
        </Disclosure>
      </div>
    </div>
  );
}

function ReceiptStep({
  loaded,
  recipient,
  outcome,
  onDone,
}: {
  loaded: Loaded;
  recipient: Hex;
  outcome: Extract<TxOutcome, { kind: 'confirmed' }>;
  onDone: () => void;
}) {
  return (
    <div>
      <div className="flex justify-center">
        <StatusLine tone="good">
          Confirmed in block {outcome.blockNumber.toLocaleString('en-US')}
        </StatusLine>
      </div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption={
          <>
            withdrawn to{' '}
            <span className="font-mono text-ink" data-numeric>
              {truncateMiddle(recipient, 10, 8)}
            </span>
          </>
        }
      />

      <div className="mt-6">
        <Disclosure label="Receipt" summary="Note spent">
          <RowGroup>
            <Row label="Amount">{formatEth(loaded.pool.denominationWei)} ETH</Row>
            <Row label="Recipient">
              <span className="font-mono">{truncateMiddle(recipient, 12, 10)}</span>
            </Row>
            <Row label="Transaction" hint={<TxRefHint simulated={outcome.simulated} />}>
              <TxRef hash={outcome.txHash} simulated={outcome.simulated} />
            </Row>
            <Row label="Note" hint="Confirmed onchain. It controls nothing now.">
              <StatusLine tone="spent">Spent</StatusLine>
            </Row>
          </RowGroup>
        </Disclosure>
      </div>

      <div className="mt-5">
        <Notice tone="neutral" title="You can delete the note file">
        This note is spent and cannot be used again. Deleting your copy is now the safer choice —
          a leaked spent note still reveals that this withdrawal came from your deposit.
        </Notice>
      </div>

      <Button variant="secondary" className="mt-5 w-full" onClick={onDone}>
        Withdraw another note
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- outcomes ---- */

function Outcome({
  tone,
  badge,
  title,
  reason,
  loaded,
  recipient,
  txHash,
  primary,
  secondary,
}: {
  tone: 'bad' | 'unknown';
  badge: string;
  title: string;
  reason: string;
  loaded: Loaded;
  recipient: Hex;
  txHash?: Hex;
  primary?: { label: string; onClick: () => void; icon?: 'retry' };
  secondary: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div className="flex justify-center">
        <StatusLine tone={tone}>{badge}</StatusLine>
      </div>
      <h2 className="mt-3 text-center text-[1.1875rem] font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-center text-[0.8125rem] leading-[1.55] text-ink-80">
        {reason}
      </p>

      <div className="mt-5 border-t border-rule pt-1">
        <RowGroup>
          <Row label="Amount">{formatEth(loaded.pool.denominationWei)} ETH</Row>
          <Row label="Recipient">
            <span className="font-mono">{truncateMiddle(recipient, 10, 8)}</span>
          </Row>
          <Row label="Note" hint="Keep the file you imported until this is resolved.">
            <Mono>{noteHandle(loaded.note)}</Mono>
          </Row>
          {txHash ? (
            <Row label="Transaction" hint={<TxRefHint simulated />}>
              <TxRef hash={txHash} simulated />
            </Row>
          ) : null}
        </RowGroup>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {primary ? (
          <Button
            variant="primary"
            className="flex-1"
            icon={primary.icon === 'retry' ? <RetryIcon width={16} height={16} /> : undefined}
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        ) : null}
        <Button variant="secondary" className={primary ? '' : 'flex-1'} onClick={secondary.onClick}>
          {secondary.label}
        </Button>
      </div>
    </div>
  );
}
