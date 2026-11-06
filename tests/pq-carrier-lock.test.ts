import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withCarrierLock } from '../src/lib/pq/carrier-lock';

test('independent helper requests queue behind one carrier lock instead of overlapping nonces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qraft-lock-')); const order: string[] = [];
  let entered!: () => void; const firstEntered = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = withCarrierLock(directory, async () => { order.push('first'); entered(); await held; order.push('released'); });
    await firstEntered;
    let waited = false;
    const second = withCarrierLock(directory, async () => { order.push('second'); }, { pollMs: 5, onWait: async () => { waited = true; release(); } });
    await Promise.all([first, second]);
    expect(waited).toBe(true); expect(order).toEqual(['first', 'released', 'second']);
  } finally { release(); await rm(directory, { recursive: true, force: true }); }
});
test('a busy carrier times out without deleting or replacing the owner lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qraft-lock-'));
  try {
    await writeFile(join(directory, 'carrier.lock'), String(process.pid)); let ran = false;
    await expect(withCarrierLock(directory, async () => { ran = true; }, { timeoutMs: 10, pollMs: 5 })).rejects.toThrow('queue is busy');
    expect(ran).toBe(false); expect(await readFile(join(directory, 'carrier.lock'), 'utf8')).toBe(String(process.pid));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a changed lock owner is preserved when an operation finishes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qraft-lock-'));
  try {
    await expect(withCarrierLock(directory, async () => {
      await writeFile(join(directory, 'carrier.lock'), '1');
    })).rejects.toThrow('ownership changed');
    expect(await readFile(join(directory, 'carrier.lock'), 'utf8')).toBe('1');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
