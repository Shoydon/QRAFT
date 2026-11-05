'use client';

import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { DEPLOYMENT, DEFAULT_POOL_REF, type PoolConfig, type PoolRef } from '@/config/pool';
import { formatEth, formatGwei, truncateMiddle } from '@/lib/format';
import { createNote, noteHandle, type PrivateNote } from '@/lib/note';
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
import { NoteSheet } from './NoteSheet';
import { TxRef, TxRefHint } from './TxRef';
import { RetryIcon, WalletIcon } from './icons';

/**
 * Deposit, as one screen rather than a wizard. Choosing an amount and sending
 * it are a single decision, so they live on a single form; the note is an
 * overlay because saving it is a hard gate, not a step to be walked through.
 */
type Stage =
  | { k: 'form' }
  | { k: 'submitting'; note: PrivateNote; phase: DepositPhase }
  | { k: 'confirming'; note: PrivateNote; txHash: Hex }
  | {
      k: 'receipt';
      note: PrivateNote;
      outcome: Extract<TxOutcome, { kind: 'confirmed' }>;
    }
  /** Submission never reached the chain. The note is untouched and reusable. */
  | { k: 'not-sent'; note: PrivateNote; reason: string }
  /** Outcome genuinely unknown. Never offers a bare retry. */
  | { k: 'unknown'; note: PrivateNote; txHash: Hex | null; reason: string }
  | { k: 'failed'; note: PrivateNote; txHash: Hex; reason: string };

export function DepositPanel({
  backend,
  account,
}: {
  backend: Backend | null;
  account: AccountState;
}) {
  const [poolRef, setPoolRef] = useState<PoolRef>(DEFAULT_POOL_REF);
  const [stage, setStage] = useState<Stage>({ k: 'form' });
  const [pending, setPending] = useState<PrivateNote | null>(null);
  const [feeFor, setFeeFor] = useState<{ ref: PoolRef; fee: FeeEstimate } | null>(null);
  const [statsFor, setStatsFor] = useState<{ ref: PoolRef; stats: PoolStats | null } | null>(null);

  const pool = DEPLOYMENT.pools.find((p) => p.ref === poolRef) as PoolConfig;
  const fee = feeFor?.ref === poolRef ? feeFor.fee : null;
  const stats = statsFor?.ref === poolRef ? statsFor.stats : undefined;

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    void backend.deposit.estimateFee(pool).then((f) => {
      if (alive) setFeeFor({ ref: pool.ref, fee: f });
    });
    void backend.poolStats.stats(pool).then((v) => {
      if (alive) setStatsFor({ ref: pool.ref, stats: v });
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
  const connected = account.status === 'connected';
  const canDeposit = connected && !wrongNetwork && !insufficient;

  async function submit(note: PrivateNote) {
    if (!backend || !account.address) return;
    setStage({ k: 'submitting', note, phase: { kind: 'signing', label: 'Waiting for your wallet' } });

    const result = await backend.deposit.submit(
      { pool, commitment: note.commitment, from: account.address },
      (phase) => setStage({ k: 'submitting', note, phase }),
    );

    if (result.kind === 'not-sent') return setStage({ k: 'not-sent', note, reason: result.reason });
    if (result.kind === 'unknown')
      return setStage({ k: 'unknown', note, txHash: result.txHash, reason: result.reason });

    setStage({ k: 'confirming', note, txHash: result.txHash });
    const outcome = await backend.reconcile.await(result.txHash, { timeoutMs: 45_000 });
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', note, outcome });
    else if (outcome.kind === 'failed')
      setStage({ k: 'failed', note, txHash: result.txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown')
      setStage({ k: 'unknown', note, txHash: result.txHash, reason: outcome.reason });
  }

  async function recheck(note: PrivateNote, txHash: Hex) {
    if (!backend) return;
    const outcome = await backend.reconcile.check(txHash);
    if (outcome.kind === 'confirmed') setStage({ k: 'receipt', note, outcome });
    else if (outcome.kind === 'failed') setStage({ k: 'failed', note, txHash, reason: outcome.reason });
    else if (outcome.kind === 'unknown') setStage({ k: 'unknown', note, txHash, reason: outcome.reason });
    else setStage({ k: 'unknown', note, txHash, reason: 'The transaction is still pending. Keep your note and check again; do not resend.' });
  }

  const feeSummary =
    fee === null
      ? '—'
      : fee.totalWei !== null
        ? `${formatEth(fee.totalWei)} ETH`
        : fee.baseFeePerGas !== null
          ? `${formatGwei(fee.baseFeePerGas)} gwei / gas`
          : 'Unavailable';

  return (
    <Card as="section" className="p-6 sm:p-8">
      <div aria-live="polite" className="sr-only">
        {stage.k === 'submitting' ? stage.phase.label : null}
        {stage.k === 'confirming' ? 'Waiting for confirmation' : null}
        {stage.k === 'receipt' ? 'Deposit confirmed' : null}
      </div>

      <div key={stage.k} className="step-enter">
        {stage.k === 'form' ? (
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
                      className={`relative cursor-pointer overflow-hidden rounded-tile py-4 text-center transition-all duration-200 ${
                        selected
                          ? 'bg-ink text-paper shadow-[0_6px_16px_-6px_rgb(13_13_15/0.45)]'
                          : 'bg-sunk text-ink-60 shadow-[inset_0_0_0_1px_rgb(13_13_15/0.06)] hover:bg-rule/50 hover:text-ink'
                      }`}
                    >
                      <input
                        type="radio"
                        name="denomination"
                        value={p.ref}
                        checked={selected}
                        onChange={() => setPoolRef(p.ref)}
                        className="sr-only"
                      />
                      <span className="block text-[1.0625rem] font-semibold" data-numeric>
                        {formatEth(p.denominationWei)}
                      </span>
                      <span
                        className={`mt-0.5 block text-[0.625rem] font-medium uppercase tracking-[0.1em] ${
                          selected ? 'text-paper/50' : 'text-ink-45'
                        }`}
                      >
                        ETH
                      </span>
                      {selected ? (
                        <span className="spectral-bar absolute inset-x-0 bottom-0 h-[3px]" />
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
                  <Row label="Pool" hint={pool.address ? undefined : 'Contract not deployed'}>
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
                  {connected ? (
                    <Row label="From">
                      <Mono>{truncateMiddle(account.address ?? '', 10, 8)}</Mono>
                    </Row>
                  ) : null}
                </RowGroup>
              </Disclosure>
            </div>

            <div className="mt-4 space-y-3 empty:mt-0">
              {account.error ? (
                <Notice tone="bad" title="Wallet problem">
                  {account.error}
                </Notice>
              ) : null}
              {wrongNetwork ? (
                <Notice
                  tone="bad"
                  title="Your wallet is on the wrong network"
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => void backend?.account.switchChain(DEPLOYMENT.chainId)}
                    >
                      Switch to {DEPLOYMENT.chainName}
                    </Button>
                  }
                >
                  This pool is on chain {DEPLOYMENT.chainId}. Your wallet reports chain{' '}
                  {account.chainId}.
                </Notice>
              ) : null}
              {insufficient && !wrongNetwork ? (
                <Notice tone="bad" title="Not enough ETH in this wallet">
                  This deposit needs {formatEth(pool.denominationWei)} ETH plus gas. This wallet
                  holds{' '}
                  {account.balanceWei === null
                    ? 'an unknown amount'
                    : `${formatEth(account.balanceWei)} ETH`}
                  . Add funds, or choose a smaller denomination.
                </Notice>
              ) : null}
            </div>

            {connected ? (
              <Button
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                disabled={!canDeposit}
                onClick={() => setPending(createNote(pool))}
              >
                Deposit {formatEth(pool.denominationWei)} ETH
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                icon={<WalletIcon width={17} height={17} />}
                busy={account.status === 'connecting'}
                onClick={() => void backend?.account.connect()}
              >
                Connect a wallet to deposit
              </Button>
            )}
          </>
        ) : null}

        {stage.k === 'submitting' ? (
          <Progress
            pool={pool}
            caption={stage.phase.label}
            detail={PHASE_COPY[stage.phase.kind]}
          />
        ) : null}

        {stage.k === 'confirming' ? (
          <Progress
            pool={pool}
            caption="Waiting for confirmation"
            detail="Submitted. This deposit is not complete until a block includes it."
          >
            <Disclosure label="Transaction" summary="Pending">
              <RowGroup>
                <Row label="Reference" hint={<TxRefHint simulated />}>
                  <TxRef hash={stage.txHash} simulated />
                </Row>
                <Row label="Status">
                  <StatusLine tone="pending" pulse>
                    Pending
                  </StatusLine>
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
                  <Row label="Transaction" hint={<TxRefHint simulated={stage.outcome.simulated} />}>
                    <TxRef hash={stage.outcome.txHash} simulated={stage.outcome.simulated} />
                  </Row>
                  <Row label="Note">
                    <Mono>{noteHandle(stage.note)}</Mono>
                  </Row>
                </RowGroup>
              </Disclosure>
            </div>
            <div className="mt-5">
              <Notice tone="neutral" title="Keep the note private">
                Anyone who gets a copy can withdraw this {pool.label} before you do. When you
                withdraw, use a recipient address with nothing to do with the wallet you just
                deposited from.
              </Notice>
            </div>
            <Button
              variant="secondary"
              size="lg"
              className="mt-5 w-full"
              onClick={() => setStage({ k: 'form' })}
            >
              Make another deposit
            </Button>
          </>
        ) : null}

        {stage.k === 'not-sent' ? (
          <Outcome
            tone="bad"
            badge="Nothing was sent"
            title="The deposit was not submitted"
            reason={stage.reason}
            note={stage.note}
            pool={pool}
            primary={{ label: 'Try again', onClick: () => void submit(stage.note) }}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'form' }) }}
          />
        ) : null}

        {stage.k === 'failed' ? (
          <Outcome
            tone="bad"
            badge="Reverted"
            title="The deposit did not go through"
            reason={stage.reason}
            note={stage.note}
            pool={pool}
            txHash={stage.txHash}
            primary={{ label: 'Try again', onClick: () => void submit(stage.note) }}
            secondary={{ label: 'Start over', onClick: () => setStage({ k: 'form' }) }}
          />
        ) : null}

        {stage.k === 'unknown' ? (
          <Outcome
            tone="unknown"
            badge="Not yet known"
            title="Outcome unknown"
            reason={`${stage.reason} Do not deposit again — a second attempt would send another ${pool.label} and create a second note.`}
            note={stage.note}
            pool={pool}
            txHash={stage.txHash ?? undefined}
            primary={
              stage.txHash
                ? {
                    label: 'Check again',
                    retry: true,
                    onClick: () => void recheck(stage.note, stage.txHash as Hex),
                  }
                : undefined
            }
            secondary={{ label: 'Leave this pending', onClick: () => setStage({ k: 'form' }) }}
          />
        ) : null}
      </div>

      <NoteSheet
        open={pending !== null}
        note={pending}
        pool={pool}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const note = pending;
          setPending(null);
          if (note) void submit(note);
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ parts -- */

function AnonymitySet({ stats }: { stats: PoolStats | null | undefined }) {
  if (stats === undefined) return <span className="text-ink-45">Counting equal deposits…</span>;
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

const PHASE_COPY: Record<DepositPhase['kind'], string> = {
  signing: 'Approve the transaction in your wallet. Nothing has been sent yet.',
  broadcasting: 'Sending the transaction to the network.',
  submitted: 'Submitted. Waiting for a block to include it.',
};

function Progress({
  pool,
  caption,
  detail,
  children,
}: {
  pool: PoolConfig;
  caption: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <Hero value={formatEth(pool.denominationWei)} unit="ETH" caption={caption} tone="pending" />
      <div className="mt-6">
        <Rail fraction={null} label={caption} />
      </div>
      <p className="mx-auto mt-3 max-w-[44ch] text-center text-[0.8125rem] leading-[1.55] text-ink-60">
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
  note,
  pool,
  txHash,
  primary,
  secondary,
}: {
  tone: 'bad' | 'unknown';
  badge: string;
  title: string;
  reason: string;
  note: PrivateNote;
  pool: PoolConfig;
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
        <Disclosure label="Details" summary={pool.label}>
          <RowGroup>
            <Row label="Your note" hint="Still valid. Keep the copy you saved.">
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
