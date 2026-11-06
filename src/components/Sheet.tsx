'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

/**
 * Detail surface. Built on the native dialog element, so focus trapping,
 * Escape, inertness of the page behind it and the top layer are the browser's
 * job rather than a reimplementation.
 *
 * This is where gradual revelation lands: the main screen carries one line,
 * and the mechanics live in here for whoever wants them.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet w-[min(30rem,calc(100vw-2rem))]"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // The dialog element itself is the backdrop's hit area.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule px-5 py-4">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1.5 rounded-pill p-1.5 text-ink-60 transition-colors hover:bg-sunk hover:text-ink"
          aria-label="Close"
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>
      <div className="max-h-[70dvh] overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
    </dialog>
  );
}
