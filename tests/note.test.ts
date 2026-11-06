import { describe, expect, test } from 'bun:test';
import { keccak256, stringToHex } from 'viem';
import { DEPLOYMENT } from '../src/config/pool';
import { createNote, FIELD, parseNote, serializeNote } from '../src/lib/note';

function withFields(fields: unknown[]): string {
  const body = JSON.stringify(fields);
  return `project-note-v1:${body}:${keccak256(stringToHex(body)).slice(2, 18)}`;
}

describe('deployment-bound bearer notes', () => {
  test('each deployed denomination round-trips without losing ownership fields', () => {
    for (const pool of DEPLOYMENT.pools) {
      const note = createNote(pool);
      const parsed = parseNote(serializeNote(note));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw Error('Note failed validation');
      expect(parsed.note).toEqual(note);
      expect(parsed.pool).toEqual(pool);
      expect(BigInt(note.nullifier)).toBeLessThan(FIELD);
      expect(BigInt(note.secret)).toBeLessThan(FIELD);
    }
  });
  test('fresh notes have independent commitments and nullifiers', () => {
    const notes = Array.from({ length: 12 }, () => createNote(DEPLOYMENT.pools[0]!));
    expect(new Set(notes.map(note => note.commitment)).size).toBe(12);
    expect(new Set(notes.map(note => note.nullifierHash)).size).toBe(12);
  });
  test('damaged files fail checksum validation', () => {
    const text = serializeNote(createNote(DEPLOYMENT.pools[0]!));
    const parsed = parseNote(`${text.slice(0, -1)}${text.endsWith('0') ? '1' : '0'}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('damaged');
  });
  test('a valid checksum cannot bypass chain, deployment or denomination checks', () => {
    const fields = [DEPLOYMENT.chainId, DEPLOYMENT.id, 1, 'eth-0.01', '1', '2'];
    for (const [index, value, expected] of [[0, DEPLOYMENT.chainId + 1, 'other-deployment'], [1, 'another-pool', 'other-deployment'], [3, 'eth-42', 'unknown-pool']] as const) {
      const changed = [...fields]; changed[index] = value;
      const parsed = parseNote(withFields(changed));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe(expected);
    }
  });
  test('noncanonical or out-of-field secrets are rejected without reflecting them', () => {
    for (const secret of [String(FIELD), '-1', '01', '1e5', 'sensitive-invalid-secret']) {
      const parsed = parseNote(withFields([DEPLOYMENT.chainId, DEPLOYMENT.id, 1, 'eth-0.01', '1', secret]));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) { expect(parsed.error.code).toBe('invalid-secret'); expect(parsed.error.message).not.toContain(secret); }
    }
  });
  test('oversized inputs are rejected before parsing', () => {
    const parsed = parseNote('x'.repeat(5000));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('too-long');
  });
});
