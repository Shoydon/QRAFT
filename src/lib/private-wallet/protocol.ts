import {encodeAbiParameters,keccak256,parseAbi,stringToHex,bytesToHex,type Hex} from 'viem';
import {domainField,noteNullifier,validateNote,TREE_DEPTH,type PoolDomain,type IndexedNote,type PrivateNote} from './model';
import {createPrivateNote,decryptNote,derivePrivateKeys,encodePrivateAddress,decodePrivateAddress,encryptNote,type PrivateKeys,type ReceivingAddress} from './crypto';
import {PrivateTree} from './tree';
export {PrivateTree,createPrivateNote,decryptNote,derivePrivateKeys,encodePrivateAddress,decodePrivateAddress,encryptNote};
export type Four=[bigint,bigint,bigint,bigint];
export type Two=[bigint,bigint];
export interface PrivateAction {root:bigint;kind:number;deposit:bigint;withdrawal:bigint;recipient:Hex;expiry:bigint;nullifiers:Four;outputs:Two;envelopes:[Hex,Hex]}
export const privatePoolAbi=parseAbi([
 'function domain() view returns(uint256)',
 'function currentRoot() view returns(uint256)',
 'function nextIndex() view returns(uint256)',
 'function spent(uint256) view returns(bool)',
 'function roots(uint256) view returns(bool)',
 'function actionDigest((uint256 root,uint8 kind,uint128 deposit,uint128 withdrawal,address recipient,uint64 expiry,uint256[4] nullifiers,uint256[2] outputs,bytes[2] envelopes) a) view returns(bytes32)',
 'function transact((uint256 root,uint8 kind,uint128 deposit,uint128 withdrawal,address recipient,uint64 expiry,uint256[4] nullifiers,uint256[2] outputs,bytes[2] envelopes) a,uint256[8] proof) payable',
 'event Output(uint256 indexed commitment,uint32 leafIndex,uint256 root,bytes envelope)',
 'event Spent(uint256 indexed nullifier)',
 'event Settled(bytes32 indexed actionId,uint8 kind,uint128 deposit,uint128 withdrawal,address recipient)',
]);
export function actionDigest(domain:PoolDomain,a:PrivateAction):Hex {
 return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'uint8'},{type:'uint128'},{type:'uint128'},{type:'address'},{type:'uint64'},{type:'uint256[4]'},{type:'uint256[2]'},{type:'bytes32'},{type:'bytes32'}],[keccak256(stringToHex('QRAFT_PRIVATE_ACTION_V1')),BigInt(domain.chainId),domain.pool,domainField(domain),a.root,a.kind,a.deposit,a.withdrawal,a.recipient,a.expiry,a.nullifiers,a.outputs,keccak256(a.envelopes[0]),keccak256(a.envelopes[1])]));
}
export function publicSignals(domain:PoolDomain,a:PrivateAction):string[]{
 const digest=BigInt(actionDigest(domain,a));
 return[a.root,domainField(domain),BigInt(a.kind),a.deposit,a.withdrawal,BigInt(a.recipient),...a.nullifiers,...a.outputs,digest>>128n,digest&((1n<<128n)-1n)].map(String);
}
export async function buildPrivateAction(args:{domain:PoolDomain;keys:PrivateKeys;tree:PrivateTree;inputs:IndexedNote[];outputs:{recipient:ReceivingAddress;amount:bigint}[];kind:0|1|2;deposit?:bigint;withdrawal?:bigint;recipient?:Hex;expiry:bigint}) {
 const {domain,keys,tree,inputs}=args;
 if(inputs.length>4||args.outputs.length>2)throw Error('Transaction needs consolidation');
 const seen=new Set<string>();
 for(const note of inputs){validateNote(domain,note);if(note.owner!==keys.owner||tree.layers[0]!.get(note.index)!==note.commitment)throw Error('Input note does not belong to this wallet and tree');if(seen.has(note.commitment.toString()))throw Error('Duplicate input note');seen.add(note.commitment.toString());}
 const notes:PrivateNote[]=args.outputs.map(o=>createPrivateNote(domain,o.recipient.owner,o.amount));
 const envelopes=await Promise.all(notes.map((n,i)=>encryptNote(domain,args.outputs[i]!.recipient,n)));
 const a:PrivateAction={root:tree.root(),kind:args.kind,deposit:args.deposit??0n,withdrawal:args.withdrawal??0n,recipient:args.recipient??'0x0000000000000000000000000000000000000000',expiry:args.expiry,nullifiers:[0n,0n,0n,0n],outputs:[0n,0n],envelopes:['0x','0x']};
 inputs.forEach((n,i)=>{if(n.owner!==keys.owner)throw Error('Not your private note');a.nullifiers[i]=noteNullifier(keys.spendingSecret,n.commitment);});
 notes.forEach((n,i)=>{a.outputs[i]=n.commitment;a.envelopes[i]=bytesToHex(envelopes[i]!);});
 const signals=publicSignals(domain,a);
 const witness={root:signals[0],domain:signals[1],kind:signals[2],deposit:signals[3],withdrawal:signals[4],recipient:signals[5],nullifiers:a.nullifiers.map(String),commitments:a.outputs.map(String),digestHi:signals[12],digestLo:signals[13],spendingSecret:String(keys.spendingSecret),inputAmounts:Array.from({length:4},(_,i)=>String(inputs[i]?.amount??0n)),inputRhos:Array.from({length:4},(_,i)=>String(inputs[i]?.rho??0n)),pathElements:Array.from({length:4},(_,i)=>inputs[i]?tree.path(inputs[i]!.index).pathElements:Array(TREE_DEPTH).fill('0')),pathIndices:Array.from({length:4},(_,i)=>inputs[i]?tree.path(inputs[i]!.index).pathIndices:Array(TREE_DEPTH).fill(0)),outputAmounts:Array.from({length:2},(_,i)=>String(notes[i]?.amount??0n)),outputOwners:Array.from({length:2},(_,i)=>String(notes[i]?.owner??0n)),outputRhos:Array.from({length:2},(_,i)=>String(notes[i]?.rho??0n))};
 return{action:a,witness,signals,notes};
}
