import { concat, fromRlp, keccak256, numberToHex, toRlp, type Hex } from 'viem';
export type { Hex } from 'viem';
/** Chain 1337 uses the EF sidecar nine-field envelope with recent roots.
 * Historical chain 8141 fixtures retain the eight-field envelope.
 * This codec neither signs nor submits transactions. */
export const FRAME_CODEC_PIN = '64b8fc09d47d7787eb1a4e3f082aa9e831dc5f8c';
export const HEGOTA_CHAIN_ID = 8141;
export const HEGOTA_GENESIS = '0x2036e3fe3eaaa15382a9befde816137b6b2cda1e3df8ca0c92e89bc17a3fca5a';
export const FrameMode = { DEFAULT: 0, VERIFY: 1, SENDER: 2 } as const; //3 is RESERVED on this client.
export const SigScheme = { ARBITRARY: 0, SECP256K1: 1, P256: 2 } as const;
export const NONCE_MANAGER_LEGACY = '0x0000000000000000000000000000000000008250' as const;
export const KEYED_NONCE_STATE_GAS = 97_920n;
export const HEGOTA_PUBLIC_VERIFY_GAS = 500_000n; //fresh RPC1/2/3 probes, operator setting, not consensus constant.
export const PUBLIC_VERIFY_STATE_GAS = 500_000n;
export const MAX_CANONICAL_TX_BYTES = 131_072;
export const WITNESS_INDEX = 0;
export const ENTRY_POINT = '0x00000000000000000000000000000000000000aa' as const;
export const TxParam = { TYPE:0x00, NONCE:0x01, SENDER:0x02, MAX_PRIORITY_FEE:0x03, MAX_FEE:0x04, MAX_BLOB_FEE:0x05, MAX_COST:0x06, BLOB_COUNT:0x07, SIG_HASH:0x08, FRAME_COUNT:0x09, CURRENT_FRAME:0x0a, SIGNATURE_COUNT:0x0b, STATE_GAS_LEFT:0x0c, LEGACY_NONCE:0x0d, NONCE_KEY_COUNT:0x0e, NONCE_KEYS_HASH:0x0f, FIRST_NONCE_KEY:0x10 } as const;
export const FrameParam = { TARGET:0x00, EXECUTION_LIMIT:0x01, MODE:0x02, FLAGS:0x03, DATA_LENGTH:0x04, PAST_STATUS:0x05, APPROVAL_SCOPE:0x06, ATOMIC:0x07, VALUE:0x08, STATE_LIMIT:0x09, PAST_EXECUTION_USED:0x0a, PAST_STATE_USED:0x0b } as const;
export type Numeric = number | bigint | string;
type Rlp = Hex | Rlp[];
const U64 = (1n << 64n) - 1n;
const I63 = (1n << 63n) - 1n;
const U256 = (1n << 256n) - 1n;
function integer(value: Numeric, maximum = U256): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('Unsafe integer');
  const n = BigInt(value);
  if (n < 0n || n > maximum) throw Error('Integer out of range');
  return n;
}
function bytes(value: Hex): Hex {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw Error('Expected whole hex bytes');
  return value.toLowerCase() as Hex;
}
const address = (value: Numeric): Hex => numberToHex(integer(value, (1n << 160n) - 1n), { size: 20 });
const rlpInt = (n: bigint): Hex => n === 0n ? '0x' : numberToHex(n, { size: Math.ceil(n.toString(16).length / 2) });
export interface FrameInit { mode: number; flags?: number; target?: Numeric | null; gasLimit: Numeric; stateGasLimit?: Numeric; value?: Numeric; data?: Hex }
export class Frame {
  readonly mode: number; readonly flags: number; readonly target: Hex | null;
  readonly gasLimit: bigint; readonly stateGasLimit: bigint; readonly value: bigint; readonly data: Hex;
  constructor(init: FrameInit) {
    this.mode = Number(integer(init.mode, 2n)); this.flags = Number(integer(init.flags ?? 0, 7n));
    this.target = init.target == null ? null : address(init.target);
    this.gasLimit = integer(init.gasLimit, I63); this.stateGasLimit = integer(init.stateGasLimit ?? 0, I63);
    this.value = integer(init.value ?? 0); this.data = bytes(init.data ?? '0x');
    if (this.mode !== FrameMode.SENDER && this.value !== 0n) throw Error('Only SENDER may carry value');
    if (this.mode === FrameMode.VERIFY && (this.flags & 4)) throw Error('VERIFY cannot be atomic');
    Object.freeze(this);
  }
  toRlp(): Rlp[] { return [rlpInt(BigInt(this.mode)), rlpInt(BigInt(this.flags)), this.target ?? '0x', [rlpInt(this.gasLimit), rlpInt(this.stateGasLimit)], rlpInt(this.value), this.data]; }
}
export interface FrameSigInit { scheme: number; signer: Numeric | null; msg?: Hex; signature?: Hex }
export class FrameSig {
  readonly scheme: number; readonly signer: Hex | null; readonly msg: Hex; readonly signature: Hex;
  constructor(init: FrameSigInit) {
    this.scheme = Number(integer(init.scheme, 2n)); this.signer = init.signer === null ? null : address(init.signer);
    this.msg = bytes(init.msg ?? '0x'); this.signature = bytes(init.signature ?? '0x');
    if (this.scheme === 0 && this.signer !== null) throw Error('ARBITRARY signer must be empty');
    if (this.msg !== '0x' && (this.msg.length !== 66 || BigInt(this.msg) === 0n)) throw Error('Message must be empty or nonzero32 bytes');
    if (this.scheme === 1 && this.signature.length !== 132) throw Error('SECP256K1 signature must have65 bytes');
    if (this.scheme === 2 && this.signature.length !== 258) throw Error('P256 signature must have128 bytes');
    Object.freeze(this);
  }
  toRlp(elide = false): Rlp[] { return [rlpInt(BigInt(this.scheme)), this.signer ?? '0x', this.msg, elide && this.msg === '0x' ? '0x' : this.signature]; }
}
export interface FrameTxInit { chainId: Numeric; nonceKeys?: readonly Numeric[]; nonceSeq: Numeric; sender: Numeric; frames: readonly Frame[]; signatures?: readonly FrameSig[]; maxPriorityFee: Numeric; maxFee: Numeric; maxBlobFee?: Numeric; blobHashes?: readonly Hex[] }
export class FrameTx {
  readonly chainId: bigint; readonly nonceKeys: readonly bigint[]; readonly nonceSeq: bigint; readonly sender: Hex;
  readonly frames: readonly Frame[]; readonly signatures: readonly FrameSig[]; readonly maxPriorityFee: bigint; readonly maxFee: bigint; readonly maxBlobFee: bigint; readonly blobHashes: readonly Hex[];
  constructor(init: FrameTxInit) {
    this.chainId = integer(init.chainId, U64); this.nonceSeq = integer(init.nonceSeq, U64); this.sender = address(init.sender);
    this.nonceKeys = Object.freeze((init.nonceKeys ?? [0]).map(x => integer(x)));
    if (!this.nonceKeys.length || this.nonceKeys.length > 16 || this.nonceKeys.some((n, i) => i > 0 && n <= this.nonceKeys[i - 1]!)) throw Error('Nonce keys must be1..16 strictly increasing uint256');
    this.frames = Object.freeze([...init.frames]); this.signatures = Object.freeze([...(init.signatures ?? [])]);
    if (!this.frames.length || this.frames.length > 64 || this.frames.some(f => !(f instanceof Frame)) || this.signatures.some(s => !(s instanceof FrameSig))) throw Error('Invalid frame/signature objects');
    this.maxPriorityFee = integer(init.maxPriorityFee); this.maxFee = integer(init.maxFee); this.maxBlobFee = integer(init.maxBlobFee ?? 0);
    if (this.maxPriorityFee > this.maxFee) throw Error('Priority fee exceeds fee cap');
    this.blobHashes = Object.freeze((init.blobHashes ?? []).map(h => { const b = bytes(h); if (b.length !== 66 || !b.startsWith('0x01')) throw Error('Invalid KZG versioned hash'); return b; }));
    if (!this.blobHashes.length && this.maxBlobFee !== 0n) throw Error('No blobs require zero blob fee');
    let total = 0n;
    for (const [i, f] of this.frames.entries()) {
      total += f.gasLimit + f.stateGasLimit;
      if (total > I63) throw Error('Combined frame budgets exceed signed63-bit bound');
      if ((f.flags & 2) && f.target !== null && f.target !== this.sender) throw Error('Execution approval target must be sender');
      if ((f.flags & 4) && (!this.frames[i + 1] || this.frames[i + 1]!.mode === 1)) throw Error('Atomic batch requires a following non-VERIFY frame');
      if (((f.flags | (this.frames[i - 1]?.flags ?? 0)) & 4) && (f.flags & 3)) throw Error('Atomic frame cannot approve');
    }
    Object.freeze(this);
  }
  private envelope(elide: boolean): Rlp[] { const fields: Rlp[] = [rlpInt(this.chainId), this.nonceKeys.map(rlpInt), rlpInt(this.nonceSeq), this.sender, this.frames.map(f => f.toRlp()), this.signatures.map(s => s.toRlp(elide)), [rlpInt(this.maxPriorityFee), rlpInt(this.maxFee), rlpInt(this.maxBlobFee)], [...this.blobHashes]]; if (this.chainId === 1337n) fields.push([]); return fields; }
  encode(): Hex { return toRlp(this.envelope(false)); }
  raw(): Hex { const raw = concat(['0x06', this.encode()]); if ((raw.length - 2) / 2 > MAX_CANONICAL_TX_BYTES) throw Error('Canonical transaction exceeds128KiB admission policy'); return raw; }
  sigHash(): Hex { return keccak256(concat(['0x06', toRlp(this.envelope(true))])); }
  transactionHash(): Hex { return keccak256(this.raw()); }
}
function list(node: Rlp, length?: number): Rlp[] { if (!Array.isArray(node) || (length !== undefined && node.length !== length)) throw Error('Wrong RLP tuple shape'); return node; }
function leaf(node: Rlp): Hex { if (typeof node !== 'string') throw Error('Expected RLP byte string'); return bytes(node); }
function decodeInt(node: Rlp): bigint { const b = leaf(node); if (b.startsWith('0x00')) throw Error('Nonminimal RLP integer'); return b === '0x' ? 0n : BigInt(b); }
function optionalAddress(node: Rlp): Hex | null { const b = leaf(node); if (b === '0x') return null; if (b.length !== 42) throw Error('Wrong address width'); return b; }
export function decodeFrameTransaction(rawInput: Hex): FrameTx {
  const raw = bytes(rawInput); if (!raw.startsWith('0x06') || (raw.length - 2) / 2 > MAX_CANONICAL_TX_BYTES) throw Error('Wrong transaction type/size');
  const v = list(fromRlp(`0x${raw.slice(4)}`, 'hex') as Rlp);
  const expectedFields = decodeInt(v[0]!) === 1337n ? 9 : 8;
  if (v.length !== expectedFields) throw Error('Wrong frame envelope for chain');
  if (expectedFields === 9 && list(v[8]!).length !== 0) throw Error('Recent-root references are not supported by this account profile');
  const tx = new FrameTx({ chainId: decodeInt(v[0]!), nonceKeys: list(v[1]!).map(decodeInt), nonceSeq: decodeInt(v[2]!), sender: optionalAddress(v[3]!) ?? (() => { throw Error('Sender cannot be empty'); })(),
    frames: list(v[4]!).map(x => { const f = list(x, 6), gas = list(f[3]!, 2); return new Frame({ mode: Number(decodeInt(f[0]!)), flags: Number(decodeInt(f[1]!)), target: optionalAddress(f[2]!), gasLimit: decodeInt(gas[0]!), stateGasLimit: decodeInt(gas[1]!), value: decodeInt(f[4]!), data: leaf(f[5]!) }); }),
    signatures: list(v[5]!).map(x => { const s = list(x, 4); return new FrameSig({ scheme: Number(decodeInt(s[0]!)), signer: optionalAddress(s[1]!), msg: leaf(s[2]!), signature: leaf(s[3]!) }); }),
    maxPriorityFee: decodeInt(list(v[6]!, 3)[0]!), maxFee: decodeInt(list(v[6]!, 3)[1]!), maxBlobFee: decodeInt(list(v[6]!, 3)[2]!), blobHashes: list(v[7]!).map(leaf) });
  if (tx.raw() !== raw) throw Error('Noncanonical frame encoding'); return tx;
}
export function nonceKeysHash(keys: readonly Numeric[]): Hex { return keccak256(concat([numberToHex(BigInt(keys.length), { size: 32 }), ...keys.map(x => numberToHex(integer(x), { size: 32 }))])); }
export interface FrameSimulation { valid?: boolean; canonicalMempoolValid?: boolean; prefixShape: string | null; payer: Hex | null; maxCost: Hex; violation: string | null; gasUsed: Hex | null; frames: { gasUsed: Hex; succeeded: boolean }[] | null; executionStatus: string | null; executionError: string | null }
export function assertSuccessfulSimulation(result: FrameSimulation, expectedFrames: number, alternative = false): void {
  if (!(result.valid === true || alternative && typeof result.canonicalMempoolValid === 'boolean') || result.violation || result.executionError || result.executionStatus !== 'success' || !result.payer || result.gasUsed === null || result.frames?.length !== expectedFrames || result.frames.some(f => f.succeeded !== true)) throw Error('Frame admission/execution simulation did not fully succeed');
}
export interface FrameReceipt { type: Hex; status: Hex; payer?: Hex; frameReceipts?: { status: Hex; gasUsed: Hex; logs: unknown[] }[] }
/** Standard receipt formatters may discard frameReceipts/payer: fetch raw JSON-RPC. */
export function assertSuccessfulReceipt(receipt: FrameReceipt, expectedFrames: number): void {
  if (BigInt(receipt.type) !== 6n || BigInt(receipt.status) !== 1n || !receipt.payer || receipt.frameReceipts?.length !== expectedFrames || receipt.frameReceipts.some(f => BigInt(f.status) !== 1n)) throw Error('Frame receipt contains failed/skipped/missing frames');
}

export function nonceSlot(sender: Numeric, nonceKey: Numeric): Hex { return keccak256(concat([numberToHex(integer(sender, (1n << 160n) - 1n), { size:32 }), numberToHex(integer(nonceKey), { size:32 })])); }
export function ownerWitness(signature: Hex): FrameSig { return new FrameSig({ scheme:SigScheme.ARBITRARY, signer:null, signature }); }
