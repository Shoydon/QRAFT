'use client';

import { useEffect, useRef, useState } from 'react';
import type { Hex } from 'viem';
import { DEPLOYMENT, DEFAULT_POOL_REF, type PoolConfig, type PoolRef } from '@/config/pool';
import { formatEth, formatGwei, truncateMiddle } from '@/lib/format';
import { createNote, noteFilename, noteHandle, serializeNote, type PrivateNote } from '@/lib/note';
import type {
  AccountState,
  Backend,
  DepositPhase,
  FeeEstimate,
  PoolStats,
  TxOutcome,
} from '@/lib/adapters/types';
import { Button, Card, Hero, Mono, Notice, Rail, Row, RowGroup, StatusLine } from './primitives';
import { Disclosure } from './Disclosure';
import { StepRail } from './StepRail';
import { TxRef, TxRefHint } from './TxRef';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  RetryIcon,
  WalletIcon,
} from './icons';

const STEPS = ['Amount', 'Note', 'Confirm', 'Receipt'] as const;

type Stage =
  | { k: 'amount' }
  | {
      k: 'note';
      note: PrivateNote;
      downloaded: boolean;
      copied: boolean;
      acknowledged: boolean;
    }
  | { k: 'wallet'; note: PrivateNote }
  | { k: 'submitting'; note: PrivateNote; phase: DepositPhase }
  | { k: 'confirming'; note: PrivateNote; txHash: Hex }
  | {
      k: 'receipt';
      note: PrivateNote;
      txHash: Hex;
      outcome: Extract<TxOutcome, { kind: 'confirmed' }>;
    }
  /** Submission never reached the chain. The note is untouched and reusable. */
  | { k: 'not-sent'; note: PrivateNote; reason: string }
  /** Outcome is genuinely unknown. Never offers a bare retry. */
  | { k: 'unknown'; note: PrivateNote; txHash: Hex | null; reason: string }
  | { k: 'failed'; note: PrivateNote; txHash: Hex; reason: string };

const stepOf = (s: Stage) =>
  s.k === 'amount' ? 0 : s.k === 'note' ? 1 : s.k === 'receipt' ? 3 : 2;

export function DepositPanel({
  backend,
  account,
}: {
  backend: Backend | null;
  account: AccountState;
}) {
  const [poolRef, setPoolRef] = useState<PoolRef>(DEFAULT_POOL_REF);
  const [stage, setStage] = useState<Stage>({ k: 'amount' });
  const [feeFor, setFeeFor] = useState<{ ref: PoolRef; fee: FeeEstimate } | null>(null);
  const [statsFor, setStatsFor] = useState<{ ref: PoolRef; stats: PoolStats | null } | null>(null);
  const liveRegion = useRef<HTMLDivElement>(null);

  const pool = DEPLOYMENT.pools.find((p) => p.ref === poolRef) as PoolConfig;

  // Keyed by pool so switching denomination reads as "loading" without an
  // extra state write, and a late response for the previous pool is ignored.
  const fee = feeFor?.ref === poolRef ? feeFor.fee : null;

  const stats = statsFor?.ref === poolRef ? statsFor.stats : undefined;

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    void backend.deposit.estimateFee(pool).then((f) => {
      if (alive) setFeeFor({ ref: pool.ref, fee: f });
    });
    void backend.poolStats.stats(pool).then((value) => {
      if (alive) setStatsFor({ ref: pool.ref, stats: value });
    });
    return () => {
      alive = false;
    };
  }, [backend, pool]);

  const wrongNetwork =
    account.status === 'connected' &&
    account.chainId !== null &&
    account.chainId !== DEPLOYMENT.chainId;

  const insufficient =
    account.status === 'connected' &&
    account.balanceWei !== null &&
    account.balanceWei <= pool.denominationWei;

  async function submit(note: PrivateNote) {
    if (!backend || !account.address) return;
    setStage({ k: 'submitting', note, phase: { kind: 'signing', label: 'Waiting for your wallet' } });

    const result = await backend.deposit.submit(
      { pool, commitment: note.commitment, from: account.address },
      (phase) => setStage({ k: 'submitting', note, phase }),
    );

    if (result.kind === 'not-sent') {
      setStage({ k: 'not-sent', note, reason: result.reason });
      return;
    }
    if (result.kind === 'unknown') {
      setStage({ k: 'unknown', note, txHash: result.txHash, reason: result.reason });
      return;
    }

    setStage({ k: 'confirming', note, txHash: result.txHash });
    const outcome = await backend.reconcile.await(result.txHash, { timeoutMs: 45_000 });

    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', note, txHash: result.txHash, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', note, txHash: result.txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', note, txHash: result.txHash, reason: outcome.reason });
  }

  async function recheck(note: PrivateNote, txHash: Hex) {
    if (!backend) return;
    const outcome = await backend.reconcile.check(txHash);
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', note, txHash, outcome });
    else if (outcome.kind === 'failed') setStage({ k: 'failed', note, txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown') setStage({ k: 'unknown', note, txHash, reason: outcome.reason });
  }

  return (
    <Card as="section" className="overflow-hidden">
      <div className="border-b border-rule px-5 pb-4 pt-5 sm:px-6">
        <StepRail steps={STEPS} current={stepOf(stage)} />
      </div>

      <div ref={liveRegion} aria-live="polite" className="sr-only">
        {stage.k === 'submitting' ? stage.phase.label : null}
        {stage.k === 'confirming' ? 'Waiting for confirmation' : null}
        {stage.k === 'receipt' ? 'Deposit confirmed' : null}
      </div>

      <div key={stage.k} className="step-enter p-5 sm:p-6">
        {stage.k === 'amount' ? (
          <AmountStep
            pool={pool}
            poolRef={poolRef}
            onPoolRef={setPoolRef}
            fee={fee}
            stats={stats}
            onNext={() =>
              setStage({
                k: 'note',
                note: createNote(pool),
                downloaded: false,
                copied: false,
                acknowledged: false,
              })
            }
          />
        ) : null}

        {stage.k === 'note' ? (
          <NoteStep
            pool={pool}
            stage={stage}
            onChange={setStage}
            onBack={() => setStage({ k: 'amount' })}
            onNext={() => setStage({ k: 'wallet', note: stage.note })}
          />
        ) : null}

        {stage.k === 'wallet' ? (
          <ConfirmStep
            pool={pool}
            fee={fee}
            account={account}
            backend={backend}
            wrongNetwork={wrongNetwork}
            insufficient={insufficient}
            onBack={() =>
              setStage({
                k: 'note',
                note: stage.note,
                downloaded: true,
                copied: false,
                acknowledged: true,
              })
            }
            onSubmit={() => void submit(stage.note)}
          />
        ) : null}

        {stage.k === 'submitting' ? <SubmittingStep pool={pool} phase={stage.phase} /> : null}

        {stage.k === 'confirming' ? <ConfirmingStep pool={pool} txHash={stage.txHash} /> : null}

        {stage.k === 'receipt' ? (
          <ReceiptStep
            pool={pool}
            note={stage.note}
            outcome={stage.outcome}
            onAgain={() => setStage({ k: 'amount' })}
          />
        ) : null}

        {stage.k === 'not-sent' ? (
          <RecoveryStep
            tone="bad"
            title="Nothing was sent"
            reason={stage.reason}
            note={stage.note}
            pool={pool}
            primary={{ label: 'Submit this deposit again', onClick: () => void submit(stage.note) }}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'amount' }) }}
          />
        ) : null}

        {stage.k === 'failed' ? (
          <RecoveryStep
            tone="bad"
            title="The deposit did not go through"
            reason={stage.reason}
            note={stage.note}
            pool={pool}
            txHash={stage.txHash}
            primary={{ label: 'Try this deposit again', onClick: () => void submit(stage.note) }}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'amount' }) }}
          />
        ) : null}

        {stage.k === 'unknown' ? (
          <RecoveryStep
            tone="unknown"
            title="Outcome unknown"
            reason={`${stage.reason} Do not submit a second deposit — that would send a second ${pool.label} and create a second note.`}
            note={stage.note}
            pool={pool}
            txHash={stage.txHash ?? undefined}
            primary={
              stage.txHash
                ? {
                    label: 'Check again',
                    icon: 'retry',
                    onClick: () => void recheck(stage.note, stage.txHash as Hex),
                  }
                : undefined
            }
            secondary={{ label: 'Leave this pending', onClick: () => setStage({ k: 'amount' }) }}
          />
        ) : null}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- step 1 ---- */

function AnonymitySet({ stats }: { stats: PoolStats | null | undefined }) {
  if (stats === undefined)
    return <span className="text-ink-45">Counting equal deposits…</span>;
  if (stats === null)
    return (
      <span className="text-state-unknown">
        The pool could not be read, so the anonymity set is unknown
      </span>
    );
  return (
    <>
      Hiding among{' '}
      <strong className="font-medium text-ink" data-numeric>
        {stats.anonymitySet.toLocaleString('en-US')}
      </strong>{' '}
      equal deposits
      {stats.simulated ? <span className="text-ink-45"> · simulated</span> : null}
    </>
  );
}

function AmountStep({
  pool,
  poolRef,
  onPoolRef,
  fee,
  stats,
  onNext,
}: {
  pool: PoolConfig;
  poolRef: PoolRef;
  onPoolRef: (r: PoolRef) => void;
  fee: FeeEstimate | null;
  stats: PoolStats | null | undefined;
  onNext: () => void;
}) {
  const feeSummary =
    fee === null
      ? '—'
      : fee.totalWei !== null
        ? `${formatEth(fee.totalWei)} ETH`
        : fee.baseFeePerGas !== null
          ? `${formatGwei(fee.baseFeePerGas)} gwei / gas`
          : 'Unavailable';

  return (
    <>
      <Hero
        value={formatEth(pool.denominationWei)}
        unit="ETH"
        caption={<AnonymitySet stats={stats} />}
      />

      <fieldset className="mt-6">
        <legend className="sr-only">Deposit denomination</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {DEPLOYMENT.pools.map((p) => {
            const selected = p.ref === poolRef;
            return (
              <label
                key={p.ref}
                className={`relative cursor-pointer rounded-tile border py-2.5 text-center transition-colors duration-[120ms] ${
                  selected
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule bg-surface text-ink-80 hover:border-ink/40 hover:text-ink'
                }`}
              >
                <input
                  type="radio"
                  name="denomination"
                  value={p.ref}
                  checked={selected}
                  onChange={() => onPoolRef(p.ref)}
                  className="sr-only"
                />
                <span className="block text-[0.9375rem] font-medium" data-numeric>
                  {formatEth(p.denominationWei)}
                </span>
                {selected ? (
                  <span className="spectral-bar absolute inset-x-4 bottom-[4px] h-[2px] rounded-full" />
                ) : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <Disclosure label="Fee and pool" summary={feeSummary}>
          <RowGroup>
            <Row label="You deposit">{formatEth(pool.denominationWei)} ETH</Row>
            <Row label="Network fee" hint={fee?.detail ?? undefined}>
              {fee === null ? <span className="text-ink-60">Reading…</span> : feeSummary}
            </Row>
            <Row label="Pool" hint={pool.address ? undefined : 'Not deployed in this build'}>
              {DEPLOYMENT.chainName} · {pool.label}
            </Row>
            <Row
              label="Anonymity set"
              hint="Unspent notes of this exact size. Your withdrawal could have come from any of them."
            >
              {stats === undefined
                ? 'Reading…'
                : stats === null
                  ? 'Unknown'
                  : stats.anonymitySet.toLocaleString('en-US')}
            </Row>
          </RowGroup>
        </Disclosure>
      </div>

      <Button
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        iconAfter={<ArrowRightIcon width={17} height={17} />}
        onClick={onNext}
      >
        Generate a note
      </Button>
    </>
  );
}

/* ---------------------------------------------------------------- step 2 ---- */

function NoteStep({
  pool,
  stage,
  onChange,
  onBack,
  onNext,
}: {
  pool: PoolConfig;
  stage: Extract<Stage, { k: 'note' }>;
  onChange: (s: Stage) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { note, downloaded, copied, acknowledged } = stage;
  const [copyFailed, setCopyFailed] = useState(false);
  const saved = downloaded || copied;

  function download() {
    const blob = new Blob([serializeNote(note)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = noteFilename(note, new Date());
    a.click();
    URL.revokeObjectURL(url);
    onChange({ ...stage, downloaded: true });
  }

  async function copy() {
    try {
      // Clipboard only. The note is never sent anywhere, here or elsewhere.
      await navigator.clipboard.writeText(serializeNote(note));
      setCopyFailed(false);
      onChange({ ...stage, copied: true });
    } catch {
      // Denied permission, or an insecure context. Say so rather than
      // silently appearing to have copied a secret that was not copied.
      setCopyFailed(true);
    }
  }

  return (
    <>
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.025em]">Save your note</h2>
      <p className="mt-1.5 max-w-[48ch] text-[0.8125rem] leading-[1.55] text-ink-60">
        This note was generated in your browser a moment ago and exists nowhere else. It is the only
        thing that can withdraw this deposit.
      </p>

      <div className="mt-5 rounded-control border border-rule bg-sunk p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-60">
            Note for {pool.label}
          </span>
          <span className="spectral-bar h-[2px] w-10 rounded-full" aria-hidden="true" />
        </div>
        <p className="mt-2.5 font-mono text-[0.8125rem] text-ink" data-numeric>
          {noteHandle(note)}
        </p>
        <p className="mt-1 text-[0.75rem] text-ink-60">
          A public reference to the commitment. The secret it protects is not shown on screen.
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          variant={saved ? 'secondary' : 'primary'}
          size="lg"
          className="flex-1"
          icon={<DownloadIcon width={17} height={17} />}
          onClick={download}
        >
          {downloaded ? 'Download again' : 'Download file'}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className="shrink-0"
          icon={copied ? <CheckIcon width={17} height={17} /> : <CopyIcon width={17} height={17} />}
          onClick={() => void copy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {copyFailed ? (
        <p className="mt-2.5 text-[0.75rem] leading-snug text-state-bad" role="alert">
          Your browser would not give this page the clipboard. Download the file instead.
        </p>
      ) : null}

      {copied && !downloaded ? (
        <p className="mt-2.5 text-[0.75rem] leading-snug text-ink-60">
          On your clipboard now. Paste it somewhere permanent before you do anything else —
          clipboards are readable by other apps and get overwritten by the next thing you copy.
        </p>
      ) : null}

      {downloaded ? (
        <p className="mt-2.5 text-[0.75rem] leading-snug text-ink-60">
          Your browser was asked to save the file. Nothing here can confirm it was kept — open the
          file and check it before you continue.
        </p>
      ) : null}

      <label
        className={`mt-5 flex cursor-pointer gap-3 rounded-control border p-3.5 transition-colors ${
          acknowledged ? 'border-ink/25 bg-sunk' : 'border-rule-strong bg-surface hover:border-ink/40'
        }`}
      >
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={!saved}
          onChange={(e) => onChange({ ...stage, acknowledged: e.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-ink)] disabled:opacity-40"
        />
        <span className="text-[0.8125rem] leading-[1.5] text-ink-80">
          I have saved this note somewhere I can find it again. I understand that if I lose it,
          this {pool.label} deposit is gone — nobody, including the people who built this, can
          recover it for me.
        </span>
      </label>

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" icon={<ArrowLeftIcon width={17} height={17} />} onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          disabled={!saved || !acknowledged}
          iconAfter={<ArrowRightIcon width={17} height={17} />}
          onClick={onNext}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- step 3 ---- */

function ConfirmStep({
  pool,
  fee,
  account,
  backend,
  wrongNetwork,
  insufficient,
  onBack,
  onSubmit,
}: {
  pool: PoolConfig;
  fee: FeeEstimate | null;
  account: AccountState;
  backend: Backend | null;
  wrongNetwork: boolean;
  insufficient: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const connected = account.status === 'connected';
  const ready = connected && !wrongNetwork && !insufficient;

  return (
    <>
      <Hero
        value={formatEth(pool.denominationWei)}
        unit="ETH"
        caption={
          connected ? (
            <>
              from{' '}
              <span className="font-mono text-ink" data-numeric>
                {truncateMiddle(account.address ?? '', 6, 4)}
              </span>
            </>
          ) : (
            'Your note is saved. Connect a wallet to fund the deposit.'
          )
        }
      />

      <div className="mt-6">
        <Disclosure
          label="Fee and wallet"
          summary={
            fee?.totalWei != null
              ? `${formatEth(fee.totalWei)} ETH`
              : fee?.baseFeePerGas != null
                ? `${formatGwei(fee.baseFeePerGas)} gwei / gas`
                : '—'
          }
        >
          <RowGroup>
            <Row label="Deposit">{formatEth(pool.denominationWei)} ETH</Row>
            <Row
              label="From"
              hint={connected ? 'Publicly linked to this deposit, never to the withdrawal.' : undefined}
            >
              {connected ? (
                <span className="font-mono">{truncateMiddle(account.address ?? '', 10, 8)}</span>
              ) : (
                <span className="text-ink-60">No wallet connected</span>
              )}
            </Row>
            <Row label="Network fee" hint={fee?.detail ?? undefined}>
              {fee?.totalWei != null
                ? `${formatEth(fee.totalWei)} ETH`
                : fee?.baseFeePerGas != null
                  ? `${formatGwei(fee.baseFeePerGas)} gwei / gas`
                  : '—'}
            </Row>
          </RowGroup>
        </Disclosure>
      </div>

      <div className="mt-4 space-y-3">
        {account.error ? (
          <Notice tone="bad" title="Wallet problem">
            {account.error}
          </Notice>
        ) : null}

        {!connected ? (
          <Notice
            tone="neutral"
            title="Connect a funding wallet"
            action={
              <Button
                variant="primary"
                icon={<WalletIcon width={16} height={16} />}
                busy={account.status === 'connecting'}
                onClick={() => void backend?.account.connect()}
              >
                Connect wallet
              </Button>
            }
          >
            Your note is already saved. Connecting now only authorizes the deposit transaction.
          </Notice>
        ) : null}

        {wrongNetwork ? (
          <Notice
            tone="bad"
            title={`Your wallet is on the wrong network`}
            action={
              <Button
                variant="secondary"
                onClick={() => void backend?.account.switchChain(DEPLOYMENT.chainId)}
              >
                Switch to {DEPLOYMENT.chainName}
              </Button>
            }
          >
            This pool is on {DEPLOYMENT.chainName} (chain {DEPLOYMENT.chainId}). Your wallet reports
            chain {account.chainId}.
          </Notice>
        ) : null}

        {insufficient && !wrongNetwork ? (
          <Notice tone="bad" title="Not enough ETH in this wallet">
            This deposit needs {formatEth(pool.denominationWei)} ETH plus gas. This wallet holds{' '}
            {account.balanceWei === null ? 'an unknown amount' : `${formatEth(account.balanceWei)} ETH`}.
            Add funds, or go back and choose a smaller denomination.
          </Notice>
        ) : null}
      </div>

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" icon={<ArrowLeftIcon width={17} height={17} />} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" className="flex-1" disabled={!ready} onClick={onSubmit}>
          Deposit {formatEth(pool.denominationWei)} ETH
        </Button>
      </div>
    </>
  );
}

/* --------------------------------------------------------- submit/confirm --- */

const PHASE_COPY: Record<DepositPhase['kind'], string> = {
  signing: 'Approve the transaction in your wallet. Nothing has been sent yet.',
  broadcasting: 'Sending the transaction to the network.',
  submitted: 'Submitted. Waiting for a block to include it.',
};

function SubmittingStep({ pool, phase }: { pool: PoolConfig; phase: DepositPhase }) {
  return (
    <div>
      <Hero value={formatEth(pool.denominationWei)} unit="ETH" caption={phase.label} />
      <div className="mt-6">
        <Rail fraction={null} label={phase.label} />
      </div>
      <p className="mt-3 text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        {PHASE_COPY[phase.kind]}
      </p>
    </div>
  );
}

function ConfirmingStep({ pool, txHash }: { pool: PoolConfig; txHash: Hex }) {
  return (
    <div>
      <Hero
        value={formatEth(pool.denominationWei)}
        unit="ETH"
        caption="Waiting for confirmation"
        tone="pending"
      />
      <div className="mt-6">
        <Rail fraction={null} label="Waiting for confirmation" />
      </div>
      <p className="mt-3 text-center text-[0.8125rem] leading-[1.55] text-ink-60">
        Submitted. This deposit is not complete until a block includes it.
      </p>
      <div className="mt-5">
        <Disclosure label="Transaction" summary="Pending">
          <RowGroup>
            <Row label="Reference" hint={<TxRefHint simulated />}>
              <TxRef hash={txHash} simulated />
            </Row>
            <Row label="Status">
              <StatusLine tone="pending" pulse>
                Pending
              </StatusLine>
            </Row>
          </RowGroup>
        </Disclosure>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- receipt ---- */

function ReceiptStep({
  pool,
  note,
  outcome,
  onAgain,
}: {
  pool: PoolConfig;
  note: PrivateNote;
  outcome: Extract<TxOutcome, { kind: 'confirmed' }>;
  onAgain: () => void;
}) {
  return (
    <div className="py-2">
      <div className="flex justify-center">
        <StatusLine tone="good">
          Confirmed in block {outcome.blockNumber.toLocaleString('en-US')}
        </StatusLine>
      </div>
      <Hero
        value={formatEth(pool.denominationWei)}
        unit="ETH"
        caption={`deposited into the ${pool.label} pool`}
      />

      <div className="mt-6">
        <Disclosure label="Receipt" summary="Transaction and note">
          <RowGroup>
            <Row label="Amount">{formatEth(pool.denominationWei)} ETH</Row>
            <Row label="Pool">
              {DEPLOYMENT.chainName} · {pool.label}
            </Row>
            <Row label="Transaction" hint={<TxRefHint simulated={outcome.simulated} />}>
              <TxRef hash={outcome.txHash} simulated={outcome.simulated} />
            </Row>
            <Row label="Note">
              <Mono>{noteHandle(note)}</Mono>
            </Row>
          </RowGroup>
        </Disclosure>
      </div>

      <div className="mt-5">
        <Notice tone="neutral" title="Keep the note file private">
        Anyone who gets a copy can withdraw this {pool.label} before you do. Do not email it, paste
        it into a chat, or store it anywhere shared. When you withdraw, use a recipient address that
          has nothing to do with the wallet you just deposited from.
        </Notice>
      </div>

      <Button variant="secondary" className="mt-5 w-full" onClick={onAgain}>
        Make another deposit
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- recovery ---- */

function RecoveryStep({
  tone,
  title,
  reason,
  note,
  pool,
  txHash,
  primary,
  secondary,
}: {
  tone: 'bad' | 'unknown';
  title: string;
  reason: string;
  note: PrivateNote;
  pool: PoolConfig;
  txHash?: Hex;
  primary?: { label: string; onClick: () => void; icon?: 'retry' };
  secondary: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div className="flex justify-center">
        <StatusLine tone={tone}>{tone === 'unknown' ? 'Not yet known' : 'Not completed'}</StatusLine>
      </div>
      <h2 className="mt-3 text-center text-[1.1875rem] font-semibold tracking-[-0.025em]">{title}</h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-center text-[0.8125rem] leading-[1.55] text-ink-80">
        {reason}
      </p>

      <div className="mt-5 border-t border-rule pt-1">
        <RowGroup>
          <Row label="Your note" hint="Still valid. Keep the file you downloaded.">
            <Mono>{noteHandle(note)}</Mono>
          </Row>
          <Row label="Pool">
            {DEPLOYMENT.chainName} · {pool.label}
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
