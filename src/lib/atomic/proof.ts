import {encodeAbiParameters,keccak256,stringToHex,decodeEventLog,type Hex} from 'viem';
import {NoteTree} from '../protocol/tree';
import type {SidecarRpc} from '../../../packages/frame-account/src/alt-mempool';
import {poolAbi} from './account';
import {hex32,type AtomicNote} from './note';
export function withdrawalDigest(note:AtomicNote,root:Hex,recipient:Hex,expiry:bigint){return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'uint256'},{type:'bytes32'},{type:'bytes32'},{type:'address'},{type:'uint64'},{type:'uint256'}],[keccak256(stringToHex('QRAFT_ATOMIC_ETH_WITHDRAWAL_V1')),1337n,note.pool,BigInt(note.denominationWei),root,note.nullifierHash,recipient,expiry,0n]));}
export async function proofInput(rpc:SidecarRpc,note:AtomicNote,recipient:Hex,expiry:bigint){
 const logs=await rpc.request<{data:Hex;topics:Hex[];removed?:boolean}[]>('eth_getLogs',[{address:note.pool,fromBlock:'0x0',toBlock:'latest',topics:[keccak256(stringToHex('Deposit(bytes32,uint32,bytes32)'))]}]);
 const leaves=logs.filter(l=>!l.removed).map(l=>decodeEventLog({abi:poolAbi,data:l.data,topics:l.topics as [Hex,...Hex[]],eventName:'Deposit'}).args).sort((a,b)=>a.leafIndex-b.leafIndex);
 const tree=new NoteTree();let index=-1;
 for(const [position,leaf] of leaves.entries()){if(leaf.leafIndex!==position)throw Error('Incomplete deposit history');if(leaf.commitment===note.commitment)index=leaf.leafIndex;tree.insert(BigInt(leaf.commitment));}
 if(index<0)throw Error('This note has no confirmed deposit');
 const root=hex32(tree.root()),digest=BigInt(withdrawalDigest(note,root,recipient,expiry));
 return{root,input:{root:String(tree.root()),nullifierHash:String(BigInt(note.nullifierHash)),recipient:String(BigInt(recipient)),txHashHi:String(digest>>128n),txHashLo:String(digest&((1n<<128n)-1n)),nullifier:note.nullifier,secret:note.secret,...tree.path(index)}};
}export async function proveInBrowser(input:Record<string,unknown>,onStatus:(s:string)=>void):Promise<[bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint]>{
 const hashes=(await import('../../../protocol/artifacts.json')).default;
 onStatus('Loading proof files');
 const artifacts=await Promise.all(['spend.wasm','spend.zkey','verification_key.json'].map(async name=>{
 const response=await fetch('/proving/'+name);if(!response.ok)throw Error('Could not load proving files');const bytes=new Uint8Array(await response.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==hashes[name as keyof typeof hashes])throw Error('Proving file integrity check failed');return bytes;
 }));
 onStatus('Generating zero-knowledge proof locally in your browser · Groth16 / BN254');
 return new Promise((resolve,reject)=>{
 const worker=new Worker('/prover.worker.js');
 const done=()=>{clearTimeout(timer);worker.terminate();};
 const timer=setTimeout(()=>{done();reject(Error('Proof generation timed out'));},180000);
 worker.onerror=()=>{done();reject(Error('Browser proof generation failed'));};
 worker.onmessage=({data})=>{
 if(data.stage){onStatus('Checking the proof locally');return;}
 done();if(data.error){reject(Error(data.error));return;}
 const expected=['root','nullifierHash','recipient','txHashHi','txHashLo'].map(k=>input[k]);
 if(JSON.stringify(data.publicSignals)!==JSON.stringify(expected)||!Array.isArray(data.proof)||data.proof.length!==8){reject(Error('Proof does not match withdrawal'));return;}
 resolve(data.proof.map(BigInt) as [bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint]);
 };
 worker.postMessage({input,wasm:artifacts[0],zkey:artifacts[1],verificationKey:JSON.parse(new TextDecoder().decode(artifacts[2]))});
 });
}
