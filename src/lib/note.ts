import { keccak256, stringToHex, type Hex } from 'viem';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import { DEPLOYMENT, poolByRef, type PoolConfig } from '@/config/pool';

/**
 * Private notes. This module is the whole note implementation and it is real:
 * real CSPRNG field elements, real Poseidon commitments, real keccak checksum.
 *
 * A note is a bearer secret. Nothing here writes to a server, a log, a URL, or
 * storage. Callers must keep it that way.
 */

/** BN254 scalar field. Note secrets are elements of it. */
export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const PREFIX = 'project-note-v1:';
const MAX_SERIALIZED = 4096;

export interface PrivateNote {
  readonly deploymentId: string;
  readonly chainId: number;
  readonly noteVersion: number;
  readonly poolRef: string;
  /** Decimal string, element of FIELD. */
  readonly nullifier: string;
  /** Decimal string, element of FIELD. */
  readonly secret: string;
  /** poseidon2(nullifier, secret) — the value published onchain at deposit. */
  readonly commitment: Hex;
  /** poseidon1(nullifier) — the value published onchain at withdrawal. */
  readonly nullifierHash: Hex;
}

export const toHex32 = (v: bigint): Hex => `0x${v.toString(16).padStart(64, '0')}`;

function randomFieldElement(): bigint {
  // Rejection sampling: modular reduction would bias the low elements.
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    if (n < FIELD) return n;
  }
}

/** Generate a note locally. Never leaves the device. */
export function createNote(pool: PoolConfig): PrivateNote {
  const nullifier = randomFieldElement();
  const secret = randomFieldElement();
  return {
    deploymentId: DEPLOYMENT.id,
    chainId: DEPLOYMENT.chainId,
    noteVersion: DEPLOYMENT.noteVersion,
    poolRef: pool.ref,
    nullifier: String(nullifier),
    secret: String(secret),
    commitment: toHex32(poseidon2([nullifier, secret])),
    nullifierHash: toHex32(poseidon1([nullifier])),
  };
}

function checksum(body: string): string {
  return keccak256(stringToHex(body)).slice(2, 18);
}

function body(note: PrivateNote): string {
  return JSON.stringify([
    note.chainId,
    note.deploymentId,
    note.noteVersion,
    note.poolRef,
    note.nullifier,
    note.secret,
  ]);
}

/**
 * Serialize for download. The result grants spending authority: it is not a
 * receipt that is safe to share. The checksum catches accidental damage; it
 * authenticates nothing.
 */
export function serializeNote(note: PrivateNote): string {
  const b = body(note);
  return PREFIX + b + ':' + checksum(b);
}

export function noteFilename(note: PrivateNote, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `project-note-${note.poolRef}-${stamp}.txt`;
}

export type NoteParseError =
  | { code: 'empty'; message: string }
  | { code: 'too-long'; message: string }
  | { code: 'not-a-note'; message: string }
  | { code: 'damaged'; message: string }
  | { code: 'unsupported-format'; message: string }
  | { code: 'other-deployment'; message: string }
  | { code: 'unknown-pool'; message: string }
  | { code: 'invalid-secret'; message: string }
  | { code: 'commitment-mismatch'; message: string };

export type NoteParseResult =
  | { ok: true; note: PrivateNote; pool: PoolConfig }
  | { ok: false; error: NoteParseError };

const fail = (code: NoteParseError['code'], message: string): NoteParseResult => ({
  ok: false,
  error: { code, message } as NoteParseError,
});

/**
 * Parse and validate a note against this deployment. Errors name the problem
 * and the recovery, and never echo note material.
 */
export function parseNote(input: string): NoteParseResult {
  const text = input.trim();
  if (!text) return fail('empty', 'Paste a note or choose a note file.');
  if (text.length > MAX_SERIALIZED)
    return fail('too-long', 'That file is too large to be a note. Choose the note file you downloaded.');
  if (!text.startsWith(PREFIX))
    return fail('not-a-note', 'This is not a note from this pool. Note files begin with "project-note-v1:".');

  const end = text.lastIndexOf(':');
  if (end <= PREFIX.length - 1)
    return fail('unsupported-format', 'This note is missing its checksum. It may have been truncated when copied.');

  const b = text.slice(PREFIX.length, end);
  if (checksum(b) !== text.slice(end + 1))
    return fail('damaged', 'This note is damaged — the checksum does not match. Re-copy it from your saved file.');

  let fields: unknown;
  try {
    fields = JSON.parse(b);
  } catch {
    return fail('unsupported-format', 'This note could not be read. Re-copy it from your saved file.');
  }
  if (!Array.isArray(fields) || fields.length !== 6)
    return fail('unsupported-format', 'This note uses a format this app does not support.');

  const [chainId, deploymentId, noteVersion, poolRef, nullifier, secret] = fields;

  if (
    chainId !== DEPLOYMENT.chainId ||
    deploymentId !== DEPLOYMENT.id ||
    noteVersion !== DEPLOYMENT.noteVersion
  )
    return fail(
      'other-deployment',
      'This note belongs to a different deployment or network. Open the app for the deployment it was created on.',
    );

  if (typeof poolRef !== 'string') return fail('unknown-pool', 'This note does not name a pool.');
  const pool = poolByRef(poolRef);
  if (!pool)
    return fail('unknown-pool', 'This note names a pool this deployment does not have.');

  for (const field of [nullifier, secret]) {
    if (typeof field !== 'string' || !/^(0|[1-9][0-9]{0,76})$/.test(field) || BigInt(field) >= FIELD)
      return fail('invalid-secret', 'This note contains an invalid secret value and cannot be used.');
  }

  const n = BigInt(nullifier as string);
  const s = BigInt(secret as string);
  const note: PrivateNote = {
    deploymentId,
    chainId,
    noteVersion,
    poolRef,
    nullifier: nullifier as string,
    secret: secret as string,
    commitment: toHex32(poseidon2([n, s])),
    nullifierHash: toHex32(poseidon1([n])),
  };

  // Round-trip the serialization to prove the parsed note re-derives byte-identically.
  if (serializeNote(note) !== text)
    return fail('commitment-mismatch', 'This note did not validate. Re-copy it from your saved file.');

  return { ok: true, note, pool };
}

/** Short, non-secret handle for referring to a note in the interface. */
export function noteHandle(note: PrivateNote): string {
  return `${note.commitment.slice(0, 10)}…${note.commitment.slice(-6)}`;
}
