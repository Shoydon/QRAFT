// Poseidon tree ported from Himitsu packages/client/src/notes.ts.
import { poseidon2 } from 'poseidon-lite';
import { keccak256, stringToHex } from 'viem';
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO = BigInt(keccak256(stringToHex('himitsu.empty.leaf'))) % FIELD;
export class NoteTree {
  readonly zeros: bigint[] = [];
  readonly leaves: bigint[] = [];
  readonly emptyRoot: bigint;
  constructor() {
    let z = ZERO;
    for (let i = 0; i < 10; i++) {
      this.zeros.push(z);
      z = poseidon2([z, z]);
    }
    this.emptyRoot = z;
  }
  insert(leaf: bigint) {
    if (leaf < 0n || leaf >= FIELD || this.leaves.length >= 1024)
      throw new Error('Invalid tree leaf');
    this.leaves.push(leaf);
  }
  layers() {
    const out = [this.leaves];
    for (let d = 0; d < 10; d++) {
      const layer = out[d]!,
        next: bigint[] = [];
      for (let i = 0; i < layer.length; i += 2)
        next.push(poseidon2([layer[i]!, layer[i + 1] ?? this.zeros[d]!]));
      out.push(next);
    }
    return out;
  }
  root() {
    return this.layers()[10]![0] ?? this.emptyRoot;
  }
  path(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length)
      throw new Error('Note is not in canonical tree');
    const layers = this.layers(),
      pathElements: string[] = [],
      pathIndices: number[] = [];
    for (let d = 0; d < 10; d++) {
      pathElements.push(String(layers[d]![index ^ 1] ?? this.zeros[d]!));
      pathIndices.push(index % 2);
      index = Math.floor(index / 2);
    }
    return { pathElements, pathIndices };
  }
}
