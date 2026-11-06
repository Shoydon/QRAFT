'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { DEPLOYMENT, type PoolConfig } from '@/config/pool';
import { checkRecipient, formatEth, truncateMiddle } from '@/lib/format';
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
import { TxRef, TxRefHint } from './TxRef';
import { FileIcon, RetryIcon, WalletIcon } from './icons';

type Loaded = { note: PrivateNote; pool: PoolConfig };

/**
 * Withdraw, as one screen. The note and the recipient are both visible from
 * the start, because they are the two things a withdrawal is, and hiding
 * either behind a step only makes the form feel longer than it is.
 */
type Stage =
  | { k: 'form' }
  | { k: 'proving'; loaded: Loaded; recipient: Hex; gas: GasPolicy; progress: ProofProgress }
  | { k: 'proof-failed'; loaded: Loaded; recipient: Hex; gas: GasPolicy; reason: string }
  | { k: 'submitting'; loaded: Loaded; recipient: Hex; phase: WithdrawPhase }
  | { k: 'confirming'; loaded: Loaded; recipient: Hex; txHash: Hex }
  | {
      k: 'receipt';
      loaded: Loaded;
      recipient: Hex;
      outcome: Extract<TxOutcome, { kind: 'confirmed' }>;
    }
  | { k: 'not-sent'; loaded: Loaded; recipient: Hex; reason: string }
  | { k: 'failed'; loaded: Loaded; recipient: Hex; txHash: Hex; reason: string }
  | { k: 'unknown'; loaded: Loaded; recipient: Hex; txHash: Hex | null; reason: string };

const STATUS_VIEW: Record<NoteStatus['kind'], { tone: Tone; label: string }> = {
  ready: { tone: 'good', label: 'Ready to withdraw' },
  pending: { tone: 'pending', label: 'Deposit not confirmed yet' },
  spent: { tone: 'spent', label: 'Already withdrawn' },
  indeterminate: { tone: 'unknown', label: 'Cannot be checked right now' },
};

export function WithdrawPanel({
  backend,
  account,
}: {
  backend: Backend | null;
  account: AccountState;
}) {
  const [stage, setStage] = useState<Stage>({ k: 'form' });
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<NoteParseError | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<NoteStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [gas, setGas] = useState<GasPolicy | null>(null);
  const [recipient, setRecipient] = useState('');
  const [touched, setTouched] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const noteId = useId();
  const toId = useId();

  const check = checkRecipient(recipient);
  const recipientError = touched && recipient.trim().length > 0 && !check.ok;
  const ready = status?.kind === 'ready';
  const sponsorBroken = gas?.kind === 'sponsor-depleted' || gas?.kind === 'sponsor-offline';
  const needsWallet = (sponsorBroken || gas?.kind === 'self-funded') && account.status !== 'connected';
  const wrongNetwork = gas?.kind === 'self-funded' && account.status === 'connected' && account.chainId !== DEPLOYMENT.chainId;
  const canWithdraw = ready && check.ok && gas !== null && !needsWallet && !wrongNetwork && (!sponsorBroken || backend?.kind === 'simulated');

  async function load(value: string) {
    const parsed = parseNote(value);
    setStatus(null);
    setGas(null);
    if (!parsed.ok) {
      setParseError(parsed.error);
      setLoaded(null);
      return;
    }
    setParseError(null);
    const next: Loaded = { note: parsed.note, pool: parsed.pool };
    setLoaded(next);
    setChecking(true);
    const s = (await backend?.noteStatus.check(parsed.note, parsed.pool)) ?? {
      kind: 'indeterminate' as const,
      reason: 'The pool cannot be read yet. Try again in a moment.',
    };
    setChecking(false);
    setStatus(s);
    if (s.kind === 'ready' && backend) setGas(await backend.withdraw.gasPolicy(next.pool, account));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 8192) {
      setParseError({
        code: 'too-long',
        message: 'That file is too large to be a note. Choose the note file you saved.',
      });
      return;
    }
    const content = await file.text();
    setText(content.trim());
    await load(content);
  }

  async function run() {
    if (!backend || !loaded || !check.ok || !gas) return;
    const controller = new AbortController();
    abort.current = controller;
    const to = check.address;

    let proof: WithdrawalProof;
    try {
      setStage({
        k: 'proving',
        loaded,
        recipient: to,
        gas,
        progress: { stage: 'artifacts', fraction: null, label: 'Preparing' },
      });
      proof = await backend.prover.prove(
        { note: loaded.note, pool: loaded.pool, recipient: to },
        (progress) => setStage({ k: 'proving', loaded, recipient: to, gas, progress }),
        controller.signal,
      );
      controller.signal.throwIfAborted();
    } catch (error) {
      if (controller.signal.aborted) { await load(text); return setStage({ k: 'form' }); }
      return setStage({
        k: 'proof-failed',
        loaded,
        recipient: to,
        gas,
        reason: error instanceof Error ? error.message : 'Proof generation failed.',
      });
    }

    setStage({
      k: 'submitting',
      loaded,
      recipient: to,
      phase: { kind: 'authorizing', label: 'Authorizing the spend' },
    });
    const result = await backend.withdraw.submit(
      { note: loaded.note, pool: loaded.pool, recipient: to, proof, gas },
      (phase) => setStage({ k: 'submitting', loaded, recipient: to, phase }),
    );

    if (result.kind === 'not-sent')
      return setStage({ k: 'not-sent', loaded, recipient: to, reason: result.reason });
    if (result.kind === 'unknown')
      return setStage({ k: 'unknown', loaded, recipient: to, txHash: result.txHash, reason: result.reason });

    setStage({ k: 'confirming', loaded, recipient: to, txHash: result.txHash });
    const outcome = await backend.reconcile.await(result.txHash, { timeoutMs: 45_000 });
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', loaded, recipient: to, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', loaded, recipient: to, txHash: result.txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', loaded, recipient: to, txHash: result.txHash, reason: outcome.reason });
  }

  async function recheckTx(l: Loaded, to: Hex, txHash: Hex) {
    if (!backend) return;
    const outcome = await backend.reconcile.check(txHash);
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', loaded: l, recipient: to, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', loaded: l, recipient: to, txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', loaded: l, recipient: to, txHash, reason: outcome.reason });
    else setStage({ k: 'unknown', loaded: l, recipient: to, txHash, reason: 'The transaction is still pending. Keep your note and check again; do not resend.' });
  }

  function reset() {
    setStage({ k: 'form' });
    setText('');
    setLoaded(null);
    setStatus(null);
    setGas(null);
    setRecipient('');
    setTouched(false);
    setParseError(null);
  }

  return (
    <Card as="section" className="p-6 sm:p-8">
      <div aria-live="polite" className="sr-only">
        {stage.k === 'proving' ? stage.progress.label : null}
        {stage.k === 'receipt' ? 'Withdrawal confirmed' : null}
      </div>

      <div key={stage.k} className="step-enter">
        {stage.k === 'form' ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={noteId} className="text-[0.8125rem] font-medium text-ink">
                Your note
              </label>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,text/plain"
                className="sr-only"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[0.75rem] font-medium text-ink-60 transition-colors hover:bg-sunk hover:text-ink"
              >
                <FileIcon width={14} height={14} />
                Choose file
              </button>
            </div>
            {loaded ? (
              // Once it validates, the secret comes off the screen. The deposit
              // side promises it is never shown; the same must hold here.
              <div className="mt-2 flex items-center justify-between gap-3 rounded-control bg-sunk px-4 py-3.5 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)]">
                <Mono className="truncate text-ink">{noteHandle(loaded.note)}</Mono>
                <button
                  type="button"
                  onClick={() => {
                    setLoaded(null);
                    setStatus(null);
                    setGas(null);
                    setText('');
                  }}
                  className="shrink-0 rounded-pill px-2 py-1 text-[0.75rem] font-medium text-ink-60 transition-colors hover:bg-sunk hover:text-ink"
                >
                  Change
                </button>
              </div>
            ) : (
              <textarea
                id={noteId}
                value={text}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                placeholder="project-note-v1:…"
                onChange={(e) => {
                  setText(e.target.value);
                  setParseError(null);
                }}
                onBlur={() => {
                  if (text.trim() && !loaded) void load(text);
                }}
                aria-invalid={parseError ? true : undefined}
                className={`mt-2 w-full resize-none rounded-control bg-sunk p-3.5 font-mono text-[0.8125rem] leading-[1.6] text-ink shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)] transition-shadow placeholder:text-ink-45 focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] ${
                  parseError ? 'shadow-[inset_0_0_0_1.5px_var(--color-state-bad)]' : ''
                }`}
              />
            )}

            {parseError ? (
              <p
                className="mt-2 flex gap-2 text-[0.8125rem] leading-[1.5] text-state-bad"
                role="alert"
              >
                <span className="mt-[7px] size-[6px] shrink-0 rounded-full bg-state-bad" />
                {parseError.message}
              </p>
            ) : null}

            {text.trim() && !loaded && !parseError ? (
              <Button
                variant="secondary"
                className="mt-2.5 w-full"
                busy={checking}
                onClick={() => void load(text)}
              >
                Check this note
              </Button>
            ) : null}

            {checking ? (
              <div className="mt-3">
                <Rail fraction={null} label="Checking the note" />
              </div>
            ) : null}

            {loaded && status ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-control bg-sunk px-4 py-3.5 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)]">
                <StatusLine tone={STATUS_VIEW[status.kind].tone} pulse={status.kind === 'pending'}>
                  {STATUS_VIEW[status.kind].label}
                </StatusLine>
                <span className="text-[0.8125rem] font-medium text-ink" data-numeric>
                  {formatEth(loaded.pool.denominationWei)} ETH
                </span>
              </div>
            ) : null}

            {status && status.kind !== 'ready' ? (
              <div className="mt-3">
                <Notice
                  tone={STATUS_VIEW[status.kind].tone}
                  title={STATUS_VIEW[status.kind].label}
                  action={
                    status.kind !== 'spent' ? (
                      <Button
                        variant="secondary"
                        icon={<RetryIcon width={15} height={15} />}
                        onClick={() => void load(text)}
                      >
                        Check again
                      </Button>
                    ) : undefined
                  }
                >
                  {status.kind === 'pending'
                    ? status.detail
                    : status.kind === 'indeterminate'
                      ? status.reason
                      : 'The nullifier for this note is already published onchain, so it no longer controls any funds. If you did not withdraw it, someone with a copy did.'}
                </Notice>
              </div>
            ) : null}

            <div className="mt-5">
              <label htmlFor={toId} className="block text-[0.8125rem] font-medium text-ink">
                Recipient address
              </label>
              <input
                id={toId}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                onBlur={() => setTouched(true)}
                spellCheck={false}
                autoComplete="off"
                placeholder="0x…"
                aria-invalid={recipientError ? true : undefined}
                className={`mt-2 h-14 w-full rounded-control bg-sunk px-4 font-mono text-[0.875rem] text-ink shadow-[inset_0_0_0_1px_rgb(13_13_15/0.07)] transition-shadow placeholder:text-ink-45 focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] ${
                  recipientError ? 'shadow-[inset_0_0_0_1.5px_var(--color-state-bad)]' : ''
                }`}
                data-numeric
              />
              <p
                className={`mt-2 text-[0.75rem] leading-snug ${recipientError ? 'text-state-bad' : 'text-ink-60'}`}
                role={recipientError ? 'alert' : undefined}
              >
                {recipientError && !check.ok
                  ? check.reason
                  : check.ok
                    ? check.checksummed
                      ? 'Valid address, checksum verified.'
                      : 'Valid address. All lowercase, so there is no checksum to verify — double-check it.'
                    : 'Use an address with no public link to the wallet that funded the deposit.'}
              </p>
            </div>

            {gas ? (
              <div className="mt-4">
                <Disclosure
                  label="Gas"
                  summary={
                    gas.kind === 'sponsored'
                      ? 'Sponsored'
                      : gas.kind === 'self-funded'
                        ? 'You pay'
                        : 'Sponsor unavailable'
                  }
                >
                  <RowGroup>
                    <Row label="Amount">{formatEth(loaded!.pool.denominationWei)} ETH</Row>
                    <Row label="Pool">
                      {DEPLOYMENT.chainName} · {loaded!.pool.label}
                    </Row>
                    <GasRow gas={gas} />
                  </RowGroup>
                </Disclosure>
              </div>
            ) : null}

            {sponsorBroken ? (
              <div className="mt-3">
                <Notice
                  tone="bad"
                  title={
                    gas.kind === 'sponsor-depleted'
                      ? 'The gas sponsor is out of funds'
                      : 'The gas sponsor is unreachable'
                  }
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
                  {gas.detail} To continue now, pay the gas yourself — that publicly links your
                  wallet to this withdrawal, though not to your deposit. Otherwise come back later:
                  your note stays valid.
                </Notice>
              </div>
            ) : null}

            {gas?.kind === 'self-funded' ? (
              <div className="mt-4 space-y-3">
                <Notice tone="neutral" title="Your wallet pays withdrawal gas">
                  The recipient receives native ETH in full. Reusing the deposit wallet for gas can link both actions; use a separate funded wallet for privacy.
                </Notice>
                {needsWallet ? <Button onClick={() => void backend?.account.connect()}>Connect a wallet to pay gas</Button> : null}
                {wrongNetwork ? <Button onClick={() => void backend?.account.switchChain(DEPLOYMENT.chainId)}>Switch to {DEPLOYMENT.chainName}</Button> : null}
              </div>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              disabled={!canWithdraw}
              onClick={() => void run()}
            >
              {loaded && ready
                ? `Withdraw ${formatEth(loaded.pool.denominationWei)} ETH`
                : 'Withdraw'}
            </Button>
          </>
        ) : null}

        {stage.k === 'proving' ? (
          <Proving
            loaded={stage.loaded}
            progress={stage.progress}
            system={backend?.prover.system ?? null}
            onCancel={() => abort.current?.abort()}
          />
        ) : null}

        {stage.k === 'submitting' ? (
          <Progress
            loaded={stage.loaded}
            caption={stage.phase.label}
            detail={WITHDRAW_PHASE_COPY[stage.phase.kind]}
          />
        ) : null}

        {stage.k === 'confirming' ? (
          <Progress
            loaded={stage.loaded}
            caption="Waiting for confirmation"
            detail="The note is only spent once a block includes this. Keep your copy until then."
          >
            <Disclosure label="Transaction" summary="Pending">
              <RowGroup>
                <Row label="Recipient">
                  <Mono>{truncateMiddle(stage.recipient, 12, 10)}</Mono>
                </Row>
                <Row label="Reference" hint={<TxRefHint simulated />}>
                  <TxRef hash={stage.txHash} simulated />
                </Row>
              </RowGroup>
            </Disclosure>
          </Progress>
        ) : null}

        {stage.k === 'receipt' ? (
          <>
            <div className="flex justify-center">
              <StatusLine tone="good">
                Confirmed in block {stage.outcome.blockNumber.toLocaleString('en-US')}
              </StatusLine>
            </div>
            <Hero
              value={formatEth(stage.loaded.pool.denominationWei)}
              unit="ETH"
              caption={
                <>
                  withdrawn to{' '}
                  <span className="font-mono text-ink" data-numeric>
                    {truncateMiddle(stage.recipient, 10, 8)}
                  </span>
                </>
              }
            />
            <div className="mt-6">
              <Disclosure label="Receipt" summary="Note spent">
                <RowGroup>
                  <Row label="Amount">{formatEth(stage.loaded.pool.denominationWei)} ETH</Row>
                  <Row label="Recipient">
                    <Mono>{truncateMiddle(stage.recipient, 12, 10)}</Mono>
                  </Row>
                  <Row label="Transaction" hint={<TxRefHint simulated={stage.outcome.simulated} />}>
                    <TxRef hash={stage.outcome.txHash} simulated={stage.outcome.simulated} />
                  </Row>
                  <Row label="Note" hint="Confirmed onchain. It controls nothing now.">
                    <StatusLine tone="spent">Spent</StatusLine>
                  </Row>
                </RowGroup>
              </Disclosure>
            </div>
            <div className="mt-5">
              <Notice tone="neutral" title="You can delete your copy of the note">
                It is spent and cannot be used again. A leaked spent note still reveals that this
                withdrawal came from your deposit.
              </Notice>
            </div>
            <Button variant="secondary" size="lg" className="mt-5 w-full" onClick={reset}>
              Withdraw another note
            </Button>
          </>
        ) : null}

        {stage.k === 'proof-failed' ? (
          <Outcome
            tone="bad"
            badge="Not completed"
            title="The proof could not be generated"
            reason={stage.reason}
            loaded={stage.loaded}
            recipient={stage.recipient}
            primary={{ label: 'Try again', retry: true, onClick: () => void run() }}
            secondary={{ label: 'Use a different note', onClick: reset }}
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
            secondary={{ label: 'Start over', onClick: reset }}
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
            secondary={{ label: 'Start over', onClick: reset }}
          />
        ) : null}

        {stage.k === 'unknown' ? (
          <Outcome
            tone="unknown"
            badge="Not yet known"
            title="Outcome unknown"
            reason={`${stage.reason} Until it resolves, do not submit this note again: a second attempt landing after the first would be rejected, and until then the note's status cannot be trusted either way.`}
            loaded={stage.loaded}
            recipient={stage.recipient}
            txHash={stage.txHash ?? undefined}
            primary={
              stage.txHash
                ? {
                    label: 'Check again',
                    retry: true,
                    onClick: () =>
                      void recheckTx(stage.loaded, stage.recipient, stage.txHash as Hex),
                  }
                : undefined
            }
            secondary={{ label: 'Leave this pending', onClick: reset }}
          />
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ parts -- */

function GasRow({ gas }: { gas: GasPolicy }) {
  if (gas.kind === 'sponsored')
    return (
      <Row
        label="Gas"
        hint={`Paid by ${gas.sponsorRef}${gas.remainingLabel ? ` · ${gas.remainingLabel}` : ''}. You need no wallet and no ETH.`}
      >
        Sponsored
      </Row>
    );
  if (gas.kind === 'self-funded')
    return (
      <Row label="Gas" hint={gas.estimate.detail ?? 'Paid from your connected wallet.'}>
        {gas.estimate.totalWei === null
          ? 'Your wallet pays'
          : `${formatEth(gas.estimate.totalWei)} ETH`}
      </Row>
    );
  return (
    <Row label="Gas" hint={gas.detail}>
      <span className="text-state-bad">Sponsor unavailable</span>
    </Row>
  );
}

const WITHDRAW_PHASE_COPY: Record<WithdrawPhase['kind'], string> = {
  authorizing: 'Authorizing the spend with your proof. Nothing has been broadcast yet.',
  broadcasting: 'Sending the withdrawal to the network.',
  submitted: 'Submitted. Waiting for a block to include it.',
};

const PROOF_STAGES: { id: ProofProgress['stage']; label: string }[] = [
  { id: 'artifacts', label: 'Proving artifacts' },
  { id: 'witness', label: 'Witness' },
  { id: 'proving', label: 'Proof' },
  { id: 'verifying', label: 'Local check' },
];

function Proving({
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
        This runs entirely on your device. Your note is not sent anywhere — the proof shows that
        some valid unspent note exists, without revealing which one.
      </p>
      <ol className="mx-auto mt-5 w-fit space-y-2">
        {PROOF_STAGES.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2.5 text-[0.8125rem]">
            <StatusLine
              tone={i < index ? 'good' : i === index ? 'pending' : 'neutral'}
              pulse={i === index}
            >
              <span className={i <= index ? 'text-ink-80' : 'text-ink-45'}>{s.label}</span>
            </StatusLine>
          </li>
        ))}
      </ol>
      {system ? null : (
        <p className="mt-5 text-center text-[0.75rem] text-ink-45">
          No prover is wired in this build, so this progress is simulated.
        </p>
      )}
      <div className="mt-4 flex justify-center">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Progress({
  loaded,
  caption,
  detail,
  children,
}: {
  loaded: Loaded;
  caption: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <Hero
        value={formatEth(loaded.pool.denominationWei)}
        unit="ETH"
        caption={caption}
        tone="pending"
      />
      <div className="mt-6">
        <Rail fraction={null} label={caption} />
      </div>
      <p className="mx-auto mt-3 max-w-[46ch] text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        {detail}
      </p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

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
  primary?: { label: string; onClick: () => void; retry?: boolean };
  secondary: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div className="flex justify-center">
        <StatusLine tone={tone}>{badge}</StatusLine>
      </div>
      <h2 className="mt-3 text-center text-[1.1875rem] font-semibold tracking-[-0.025em]">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-center text-[0.8125rem] leading-[1.55] text-ink-80">
        {reason}
      </p>
      <div className="mt-5">
        <Disclosure label="Details" summary={loaded.pool.label}>
          <RowGroup>
            <Row label="Amount">{formatEth(loaded.pool.denominationWei)} ETH</Row>
            <Row label="Recipient">
              <Mono>{truncateMiddle(recipient, 12, 10)}</Mono>
            </Row>
            <Row label="Note" hint="Keep your copy until this is resolved.">
              <Mono>{noteHandle(loaded.note)}</Mono>
            </Row>
            {txHash ? (
              <Row label="Transaction" hint={<TxRefHint simulated />}>
                <TxRef hash={txHash} simulated />
              </Row>
            ) : null}
          </RowGroup>
        </Disclosure>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        {primary ? (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            icon={primary.retry ? <RetryIcon width={16} height={16} /> : undefined}
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          className={primary ? '' : 'flex-1'}
          onClick={secondary.onClick}
        >
          {secondary.label}
        </Button>
      </div>
    </div>
  );
}
