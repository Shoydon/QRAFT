import { formatUnits, getAddress, isAddress, type Hex } from 'viem';

/** Trim trailing zeros but keep at least one decimal place for ETH amounts. */
export function formatEth(wei: bigint, maxFractionDigits = 6): string {
  const raw = formatUnits(wei, 18);
  if (!raw.includes('.')) return raw;
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.slice(0, maxFractionDigits).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : (whole as string);
}

export function formatGwei(wei: bigint): string {
  const raw = formatUnits(wei, 9);
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n < 1 ? n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : n.toFixed(2);
}

export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

export type AddressCheck =
  | { ok: true; address: Hex; checksummed: boolean }
  | { ok: false; reason: string };

/** Validate a recipient. Names the problem and the fix. */
export function checkRecipient(input: string): AddressCheck {
  const value = input.trim();
  if (!value) return { ok: false, reason: 'Enter the address that should receive the withdrawal.' };
  if (!value.startsWith('0x'))
    return { ok: false, reason: 'An Ethereum address starts with 0x.' };
  if (value.length !== 42)
    return {
      ok: false,
      reason: `An address is 42 characters. This one is ${value.length}.`,
    };
  if (!/^0x[0-9a-fA-F]{40}$/.test(value))
    return { ok: false, reason: 'This address contains characters that are not hexadecimal.' };
  if (/^0x0{40}$/.test(value))
    return { ok: false, reason: 'The zero address cannot receive a withdrawal.' };

  const mixed = /[a-f]/.test(value.slice(2)) && /[A-F]/.test(value.slice(2));
  if (mixed && !isAddress(value, { strict: true }))
    return {
      ok: false,
      reason: 'This address fails its capitalisation checksum. Re-copy it from the source.',
    };

  return { ok: true, address: getAddress(value), checksummed: mixed };
}

export function explorerTxUrl(base: string | null, hash: string): string | null {
  return base ? `${base.replace(/\/$/, '')}/tx/${hash}` : null;
}
