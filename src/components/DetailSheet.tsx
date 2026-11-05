'use client';

import { useState } from 'react';
import { DEPLOYMENT, TRANSPORT } from '@/config/pool';
import type { ChainTransport, TransportStatus } from '@/lib/transport/types';
import { Button, Row, RowGroup, StatusDot, StatusLine, type Tone } from './primitives';
import { Sheet } from './Sheet';
import { ChevronIcon, RetryIcon } from './icons';

const TONE: Record<TransportStatus['phase'], Tone> = {
  idle: 'neutral',
  'not-configured': 'unknown',
  starting: 'pending',
  ready: 'good',
  failed: 'bad',
};

const LABEL: Record<TransportStatus['phase'], string> = {
  idle: 'not started',
  'not-configured': 'not configured',
  starting: 'connecting',
  ready: 'active',
  failed: 'unavailable',
};

/**
 * One line on the main screen, the whole story behind it. The line always
 * states the current read path truthfully, so nothing important is hidden by
 * the disclosure — only the detail is.
 */
export function ReadPathLine({
  status,
  transport,
}: {
  status: TransportStatus;
  transport: ChainTransport | null;
}) {
  const [open, setOpen] = useState(false);
  const anonymizing = TRANSPORT.worker.anonymizing;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex items-center gap-2 rounded-pill px-3 py-1.5 text-[0.75rem] text-ink-60 transition-colors hover:bg-sunk hover:text-ink"
      >
        <StatusDot tone={TONE[status.phase]} pulse={status.phase === 'starting'} />
        <span>
          {DEPLOYMENT.chainName} · {anonymizing ? '' : 'un-anonymized '}
          {TRANSPORT.worker.label} reads · {LABEL[status.phase]}
        </span>
        <ChevronIcon width={14} height={14} className="text-ink-45" />
        <span className="sr-only">Open read path and privacy detail</span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="How this works">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[0.875rem] font-semibold tracking-[-0.01em]">Read path</h3>
            <StatusLine tone={TONE[status.phase]} pulse={status.phase === 'starting'}>
              {LABEL[status.phase]}
            </StatusLine>
          </div>

          {anonymizing ? (
            <p className="mt-2.5 text-[0.8125rem] leading-[1.55] text-ink-80">
              Chain reads go through the{' '}
              <strong className="font-medium">{TRANSPORT.worker.label}</strong> anonymizing network
              by default, so the RPC provider sees the question but not the browser asking it.
              There is no direct-RPC fallback: if this path is unavailable, reads stop rather than
              quietly deanonymizing you.
            </p>
          ) : (
            <p className="mt-2.5 text-[0.8125rem] leading-[1.55] text-ink-80">
              This build uses the <strong className="font-medium">{TRANSPORT.worker.label}</strong>{' '}
              worker, which fulfils reads with an ordinary fetch.{' '}
              <strong className="font-medium text-state-bad">Your reads are not anonymized.</strong>{' '}
              It exercises the sandbox and the hash pinning, nothing more.
            </p>
          )}

          <div className="mt-3 border-t border-rule pt-1">
            <RowGroup>
              <Row
                label="Read worker"
                hint={anonymizing ? undefined : 'Does not anonymize'}
              >
                {TRANSPORT.worker.label}
              </Row>
              <Row
                label="Client integrity"
                hint={`Pinned by a specifier contract on ${TRANSPORT.worker.specifierChain}`}
              >
                keccak256-pinned
              </Row>
              <Row
                label="Bootstrap read"
                hint="One un-anonymized read, to learn the pinned hash. It reveals that a specifier contract was read, not any address."
              >
                {TRANSPORT.bootstrapRpcUrl ? 'Configured' : 'Not set'}
              </Row>
              {status.phase === 'ready' ? (
                <Row
                  label="Reads this session"
                  hint={
                    status.lastLatencyMs === null ? undefined : `Last took ${status.lastLatencyMs} ms`
                  }
                >
                  {status.requestCount}
                </Row>
              ) : null}
            </RowGroup>
          </div>

          {status.detail ? (
            <div className="mt-3 rounded-control border border-rule bg-sunk p-3">
              <p className="text-[0.8125rem] leading-[1.5] text-ink-80">{status.detail}</p>
              {status.phase === 'failed' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  icon={<RetryIcon width={14} height={14} />}
                  onClick={() => {
                    transport?.stop();
                    transport?.start();
                  }}
                >
                  Retry connection
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="mt-7 border-t border-rule pt-5">
          <h3 className="text-[0.875rem] font-semibold tracking-[-0.01em]">What is public</h3>
          <p className="mt-2.5 text-[0.8125rem] leading-[1.55] text-ink-80">
            Both halves of this are public on {DEPLOYMENT.chainName}: anyone can see a deposit
            arrive and a withdrawal leave, with amounts and timestamps. The property the pool
            provides is that no observer can tell <em>which</em> deposit funded <em>which</em>{' '}
            withdrawal.
          </p>
          <p className="mt-2.5 text-[0.8125rem] leading-[1.55] text-ink-80">
            That link hides among the other unspent notes of the same denomination, so it is only
            as strong as how many there are. Withdrawing soon after depositing, or paying gas from
            an address already tied to you, narrows it again. This is not a guarantee of anonymity.
          </p>
          <ul className="mt-4 space-y-2.5 border-t border-rule pt-4 text-[0.8125rem] leading-[1.5] text-ink-80">
            {[
              'Your note is generated in this browser and stays in memory. It is never sent anywhere, and never written to a URL, a log, or an error report.',
              'Downloading a note is the only copy you get. Nothing here backs it up for you.',
              'Withdrawal proofs are built on your device. The proof reveals that a valid unspent note exists, not which one.',
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-[7px] size-[3px] shrink-0 rounded-full bg-ink-45" />
                {line}
              </li>
            ))}
          </ul>
        </section>
      </Sheet>
    </>
  );
}
