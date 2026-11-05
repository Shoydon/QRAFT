/**
 * The acronym as a roadmap. Each part spells its real words out; the letters
 * that form QRAFT are the ones set in ink, so the name reads out of the
 * phrase rather than being pasted in front of it.
 */
const PARTS = [
  {
    key: 'qr',
    words: [
      { lead: 'Q', tail: 'uantum' },
      { lead: 'R', tail: 'esistant' },
    ],
    join: '-',
    built: false,
    body: 'Post-quantum account access, kept deliberately separate from note ownership so that losing one cannot lose the other. Not implemented — the commitments and proofs in this build are classical.',
  },
  {
    key: 'a',
    words: [{ lead: 'A', tail: 'nonymous' }],
    join: '',
    built: true,
    body: 'The pool itself, plus private reads. Deposits and withdrawals are unlinkable onchain, and every chain read the app makes is routed through an anonymizing network by default.',
  },
  {
    key: 'ft',
    words: [
      { lead: 'F', tail: 'rame' },
      { lead: 'T', tail: 'ransactions' },
    ],
    join: '\u00A0',
    built: false,
    body: 'EIP-8141, via the alternative mempool. It would let the pool pay for a withdrawal itself, so a fresh recipient address never needs ETH of its own — the last place a user can accidentally link the two halves.',
  },
];

export function Letters() {
  return (
    <ol className="grid gap-px overflow-hidden rounded-card border border-rule bg-rule sm:grid-cols-3">
      {PARTS.map((p) => (
        <li key={p.key} className="flex flex-col bg-surface p-6">
          <h3 className="flex flex-wrap items-baseline text-[1.5rem] leading-tight tracking-[-0.03em]">
            {p.words.map((w, i) => (
              <span key={w.lead}>
                {i > 0 && p.join ? (
                  <span className="font-normal text-ink-45">{p.join}</span>
                ) : null}
                <span className="font-semibold text-ink">{w.lead}</span>
                <span className="text-[1.0625rem] font-normal text-ink-60">{w.tail}</span>
              </span>
            ))}
          </h3>

          <p
            className={`mt-3 inline-flex items-center gap-2 text-[0.75rem] font-medium ${
              p.built ? 'text-state-good' : 'text-ink-60'
            }`}
          >
            <span
              className={`inline-block size-[7px] rounded-full ${
                p.built ? 'bg-state-good' : 'bg-rule-strong'
              }`}
            />
            {p.built ? 'Built' : 'Not built yet'}
          </p>

          <p className="mt-3.5 text-[0.875rem] leading-[1.6] text-ink-80">{p.body}</p>

          {p.built ? (
            <span className="spectral-bar mt-auto block h-[2px] w-full translate-y-6 rounded-full" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
