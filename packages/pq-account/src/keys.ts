import { ml_dsa44 } from '@noble/post-quantum/ml-dsa.js';
import { shake128, shake256 } from '@noble/hashes/sha3.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';

export const ALGORITHM = 'ML-DSA-44' as const;
export const KEY_BYTES = 1312;
export const SIGNATURE_BYTES = 2420;
const Q = 8380417;
const mod = (v: number) => ((v % Q) + Q) % Q;
function pow(a: number, n: number): number {
  let out = 1;
  for (; n; n >>>= 1, a = mod(a * a)) if (n & 1) out = mod(out * a);
  return out;
}
const zetas = Array.from({ length: 256 }, (_, i) =>
  pow(1753, parseInt(i.toString(2).padStart(8, '0').split('').reverse().join(''), 2)),
);
function ntt(coefficients: number[]): number[] {
  const w = [...coefficients];
  let m = 0;
  for (let length = 128; length >= 1; length >>= 1) {
    for (let start = 0; start < 256; start += 2 * length) {
      const z = zetas[++m]!;
      for (let j = start; j < start + length; j++) {
        const t = mod(z * w[j + length]!);
        w[j + length] = mod(w[j]! - t);
        w[j] = mod(w[j]! + t);
      }
    }
  }
  return w;
}
function decodeKey(pk: Uint8Array): number[][] {
  if (pk.length !== KEY_BYTES) throw new Error('Expected a 1312-byte ML-DSA-44 public key');
  const rows = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 256 }, (_, i) => {
      const bit = i * 10,
        at = 32 + row * 320 + (bit >>> 3);
      return (
        ((pk[at]! | ((pk[at + 1] ?? 0) << 8) | ((pk[at + 2] ?? 0) << 16)) >>> (bit & 7)) & 1023
      );
    }),
  );
  // Upstream SAFETY.md §3.1: mandatory degenerate-key rejection floor.
  const large = rows.flat().filter((v) => {
    const t = mod(v * 8192);
    return Math.abs(t > Q / 2 ? t - Q : t) > (Q - 1) / 88;
  }).length;
  if (large < 512) throw new Error('Refusing a degenerate ML-DSA public key');
  return rows;
}
/** Exact public-only transform of pinned upstream prepare.py; differential-tested. */
export function preparePublicKey(pk: Uint8Array): Uint8Array {
  const rows = decodeKey(pk);
  const out = new Uint8Array(20545);
  out.set(shake256(pk, { dkLen: 64 }), 1);
  let offset = 65;
  const append = (coefficients: number[]) => {
    const view = new DataView(out.buffer);
    for (let w = 0; w < 32; w++)
      for (let s = 0; s < 8; s++)
        view.setUint32(offset + w * 32 + (7 - s) * 4, coefficients[8 * w + s]!, false);
    offset += 1024;
  };
  for (const row of rows) append(ntt(row.map((v) => mod(v * 8192))));
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let length = 864,
        coefficients: number[] = [];
      while (coefficients.length < 256) {
        const stream = shake128(concatBytes(pk.subarray(0, 32), new Uint8Array([j, i])), {
          dkLen: length,
        });
        coefficients = [];
        for (let p = 0; p + 2 < stream.length && coefficients.length < 256; p += 3) {
          const value = stream[p]! | (stream[p + 1]! << 8) | ((stream[p + 2]! & 127) << 16);
          if (value < Q) coefficients.push(value);
        }
        length *= 2;
      }
      append(coefficients);
    }
  return out;
}
export interface PQKey {
  seed: Uint8Array;
  publicKey: Uint8Array;
}
export function createKey(seed: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): PQKey {
  if (seed.length !== 32) throw new Error('Expected a 32-byte signing seed');
  const pair = ml_dsa44.keygen(seed);
  pair.secretKey.fill(0);
  preparePublicKey(pair.publicKey);
  return { seed: seed.slice(), publicKey: pair.publicKey };
}
export function signAuthorization(key: PQKey, message: Hex): Hex {
  const pair = ml_dsa44.keygen(key.seed);
  try {
    if (bytesToHex(pair.publicKey) !== bytesToHex(key.publicKey))
      throw new Error('Signing seed does not match public key');
    const signature = ml_dsa44.sign(hexToBytes(message), pair.secretKey);
    if (!ml_dsa44.verify(signature, hexToBytes(message), key.publicKey))
      throw new Error('Local PQ verification failed');
    return bytesToHex(signature);
  } finally {
    pair.secretKey.fill(0);
  }
}
export function verifyAuthorization(pk: Uint8Array, message: Hex, signature: Hex): boolean {
  try {
    return ml_dsa44.verify(hexToBytes(signature), hexToBytes(message), pk);
  } catch {
    return false;
  }
}
