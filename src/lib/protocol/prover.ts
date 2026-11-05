import type { Hex } from 'viem';
import { DEPLOYMENT, PROVING_HASHES, type PoolConfig } from '@/config/pool';
import { toHex32, type PrivateNote } from '@/lib/note';
import type { ProofProgress } from '@/lib/adapters/types';
import type { NoteTree } from './tree';
import { withdrawalDigest, type NativeProof, type ProofWords } from './pool';

const artifacts = new Map<string, Promise<Uint8Array>>();
async function artifact(name: keyof typeof PROVING_HASHES, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const hash = PROVING_HASHES[name];
  let pending = artifacts.get(hash);
  if (!pending) {
    pending = (async () => {
      // The shared artifact fetch is independent of one proof's cancellation.
      const response = await fetch(`/proving/${name}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw Error('Could not load the proving files. Nothing was submitted.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
      if (actual !== hash) throw Error('The proving files do not match this deployment. Nothing was submitted.');
      return bytes;
    })();
    artifacts.set(hash, pending);
    pending.catch(() => artifacts.delete(hash));
  }
  const bytes = await pending;
  signal.throwIfAborted();
  return bytes;
}

export async function proveWithdrawal(note: PrivateNote, pool: PoolConfig, recipient: Hex,
  tree: NoteTree, index: number, onProgress: (progress: ProofProgress) => void, signal: AbortSignal,
): Promise<NativeProof> {
  if (!pool.address) throw Error('This pool is not deployed.');
  onProgress({ stage: 'artifacts', fraction: null, label: 'Loading and checking the proving files' });
  const [wasm, zkey, key] = await Promise.all([
    artifact('spend.wasm', signal), artifact('spend.zkey', signal), artifact('verification_key.json', signal),
  ]);
  onProgress({ stage: 'witness', fraction: null, label: 'Building your note’s private Merkle witness' });
  const root = toHex32(tree.root());
  const digest = BigInt(withdrawalDigest(DEPLOYMENT.chainId, pool.address, pool.denominationWei, root, note.nullifierHash, recipient));
  const input = {
    root: String(tree.root()), nullifierHash: String(BigInt(note.nullifierHash)), recipient: String(BigInt(recipient)),
    txHashHi: String(digest >> 128n), txHashLo: String(digest & (2n ** 128n - 1n)),
    nullifier: note.nullifier, secret: note.secret, ...tree.path(index),
  };
  const expected = [input.root, input.nullifierHash, input.recipient, input.txHashHi, input.txHashLo];
  signal.throwIfAborted();
  onProgress({ stage: 'proving', fraction: null, label: 'Generating the proof in this browser' });
  const words = await new Promise<ProofWords>((resolve, reject) => {
    const worker = new Worker('/prover.worker.js');
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(new DOMException('Proof cancelled', 'AbortError')); };
    const timer = setTimeout(() => { finish(); reject(Error('Proof generation timed out. Nothing was submitted.')); }, 180_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = () => { finish(); reject(Error('The browser prover failed. Nothing was submitted.')); };
    worker.onmessage = ({ data }: MessageEvent<{ stage?: string; error?: string; proof?: string[]; publicSignals?: string[] }>) => {
      if (data.stage === 'verifying') { onProgress({ stage: 'verifying', fraction: null, label: 'Checking the proof locally' }); return; }
      finish();
      if (data.error) { reject(Error(data.error)); return; }
      if (!data.proof || data.proof.length !== 8 || data.proof.some(word => !/^[0-9]{1,78}$/.test(word)) ||
        JSON.stringify(data.publicSignals) !== JSON.stringify(expected)) { reject(Error('The proof does not match this withdrawal. Nothing was submitted.')); return; }
      resolve(data.proof.map(BigInt) as unknown as ProofWords);
    };
    worker.postMessage({ input, wasm, zkey, verificationKey: JSON.parse(new TextDecoder().decode(key)) });
    if (signal.aborted) cancel();
  });
  onProgress({ stage: 'verifying', fraction: 1, label: 'Proof verified locally' });
  return { root, words, recipient, pool: pool.address, deploymentId: DEPLOYMENT.id };
}
