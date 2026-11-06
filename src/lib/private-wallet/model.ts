import {keccak256,encodeAbiParameters,stringToHex,type Hex} from 'viem';
import {poseidon2,poseidon3,poseidon5} from 'poseidon-lite';

export const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const MAX_AMOUNT=(1n<<128n)-1n;
export const TREE_DEPTH=20;
export const INPUT_COUNT=4;
export const OUTPUT_COUNT=2;
export const ENVELOPE_BYTES=1197;
export interface PoolDomain {chainId:number;genesisHash:Hex;pool:Hex}
export interface PrivateNote {owner:bigint;amount:bigint;rho:bigint;commitment:bigint}
export interface IndexedNote extends PrivateNote {index:number}
export const hex32=(value:bigint):Hex=>`0x${value.toString(16).padStart(64,'0')}`;
export function domainField(domain:PoolDomain):bigint {
 return BigInt(keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'bytes32'},{type:'address'}],[keccak256(stringToHex('QRAFT_PRIVATE_ETH_V1')),BigInt(domain.chainId),domain.genesisHash,domain.pool])))%FIELD;
}
export const ownerCommitment=(secret:bigint)=>poseidon2([1n,secret]);
export const noteCommitment=(domain:PoolDomain,note:Pick<PrivateNote,'owner'|'amount'|'rho'>)=>poseidon5([2n,domainField(domain),note.owner,note.amount,note.rho]);
export const noteNullifier=(secret:bigint,commitment:bigint)=>poseidon3([3n,secret,commitment]);
export function validateNote(domain:PoolDomain,note:PrivateNote):void {
 if(note.amount<=0n||note.amount>MAX_AMOUNT||note.owner<=0n||note.owner>=FIELD||note.rho<=0n||note.rho>=FIELD||note.commitment!==noteCommitment(domain,note))throw Error('Invalid private note');
}
