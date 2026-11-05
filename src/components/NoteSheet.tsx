'use client';

import { useState } from 'react';
import type { PoolConfig } from '@/config/pool';
import { noteFilename, noteHandle, serializeNote, type PrivateNote } from '@/lib/note';
import { Button } from './primitives';
import { Sheet } from './Sheet';
import { CheckIcon, CopyIcon, DownloadIcon } from './icons';

/**
 * The note, as an overlay over the deposit form rather than a step in a
 * wizard. The deposit cannot proceed until it has been saved and the loss is
 * acknowledged — the one place in this product where a gate is correct,
 * because the consequence is unrecoverable.
 */
export function NoteSheet({
  open,
  note,
  pool,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  note: PrivateNote | null;
  pool: PoolConfig;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const saved = downloaded || copied;

  function reset() {
    setDownloaded(false);
    setCopied(false);
    setCopyFailed(false);
    setAcknowledged(false);
  }

  function download() {
    if (!note) return;
    const blob = new Blob([serializeNote(note)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = noteFilename(note, new Date());
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  async function copy() {
    if (!note) return;
    try {
      await navigator.clipboard.writeText(serializeNote(note));
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onCancel();
      }}
      title="Save your note"
    >
      <p className="text-[0.875rem] leading-[1.6] text-ink-80">
        This was generated in your browser a moment ago and exists nowhere else. It is the only
        thing that can withdraw this {pool.label}.
      </p>

      <div className="mt-4 rounded-control border border-rule bg-sunk p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-60">
            Note for {pool.label}
          </span>
          <span className="spectral-bar h-[2px] w-10 rounded-full" aria-hidden="true" />
        </div>
        <p className="mt-2.5 font-mono text-[0.8125rem] text-ink" data-numeric>
          {note ? noteHandle(note) : '—'}
        </p>
        <p className="mt-1 text-[0.75rem] leading-snug text-ink-60">
          A public reference to the commitment. The secret it protects is never shown on screen.
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
          clipboards are readable by other apps and get overwritten by the next copy.
        </p>
      ) : null}
      {downloaded ? (
        <p className="mt-2.5 text-[0.75rem] leading-snug text-ink-60">
          Your browser was asked to save the file. Nothing here can confirm it was kept — open it
          and check before you continue.
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
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-ink)] disabled:opacity-40"
        />
        <span className="text-[0.8125rem] leading-[1.5] text-ink-80">
          I have saved this note somewhere I can find it again. If I lose it, this {pool.label}{' '}
          deposit is gone — nobody, including the people who built this, can recover it for me.
        </span>
      </label>

      <Button
        variant="primary"
        size="lg"
        className="mt-5 w-full"
        disabled={!saved || !acknowledged}
        onClick={() => {
          reset();
          onConfirm();
        }}
      >
        Confirm and deposit
      </Button>
    </Sheet>
  );
}
