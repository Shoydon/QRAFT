import { encodeAbiParameters, keccak256, parseAbi, stringToHex, type Hex } from 'viem';

export const poolAbi = parseAbi([
  'function deposit(bytes32 commitment) payable',
  'function withdraw(bytes32 root,bytes32 nullifierHash,address recipient,uint256[8] proof)',
  'function currentRoot() view returns (bytes32)',
  'function denomination() view returns (uint256)',
  'function nextIndex() view returns (uint256)',
  'function withdrawalCount() view returns (uint256)',
  'function spent(bytes32) view returns (bool)',
  'function commitments(bytes32) view returns (bool)',
  'event Deposit(bytes32 indexed commitment,uint32 leafIndex,bytes32 root)',
  'event Withdrawal(bytes32 indexed nullifierHash,address indexed recipient,uint256 amount)',
]);

export function withdrawalDigest(chainId: number, pool: Hex, amount: bigint, root: Hex, nullifier: Hex, recipient: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }],
    [keccak256(stringToHex('QRAFT_NATIVE_ETH_WITHDRAWAL_V1')), BigInt(chainId), pool, amount, root, nullifier, recipient],
  ));
}

export type ProofWords = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

export interface NativeProof {
  readonly root: Hex;
  readonly words: ProofWords;
  readonly recipient: Hex;
  readonly pool: Hex;
  readonly deploymentId: string;
}
