import {bytesToHex,encodeFunctionData,hexToBytes,parseAbi,type Hex} from 'viem';
import {Frame,FrameSig,FrameTx,assertSuccessfulReceipt,decodeFrameTransaction} from '../../../packages/frame-account/src/frametx';
import {createKey,preparePublicKey,signAuthorization,type PQKey} from '../../../packages/pq-account/src/keys';
import {submitToSidecar,type SidecarRpc} from '../../../packages/frame-account/src/alt-mempool';
export const accountAbi=parseAbi(['function verify(bytes key)','function keyCommitment() view returns(bytes32)']);
export const poolAbi=parseAbi(['function deposit(bytes32 commitment) payable','function withdraw(bytes32 root,bytes32 nullifierHash,address recipient,uint64 expiry,uint256[8] proof)','function denomination() view returns(uint256)','function currentRoot() view returns(bytes32)','function spent(bytes32) view returns(bool)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,bytes32 root)']);
export function atomicPlan(address:Hex,key:PQKey,nonce:bigint,paymaster:Hex,pool:Hex,data:Hex,value=0n){
 return new FrameTx({chainId:1337,sender:address,nonceKeys:[0],nonceSeq:nonce,maxFee:128,maxPriorityFee:1,signatures:[new FrameSig({scheme:0,signer:null,signature:`0x${'00'.repeat(2420)}`})],frames:[
 new Frame({mode:1,flags:2,target:address,gasLimit:4000000,data:encodeFunctionData({abi:accountAbi,functionName:'verify',args:[bytesToHex(preparePublicKey(key.publicKey).subarray(1))]})}),
 new Frame({mode:1,flags:1,target:paymaster,gasLimit:120000,stateGasLimit:97920,data:'0x1b9265b8'}),
 new Frame({mode:2,target:pool,gasLimit:3000000,stateGasLimit:4000000,data,value}),
 ]});
}
export function signAtomic(plan:FrameTx,key:PQKey){const tx=new FrameTx({...plan,signatures:[new FrameSig({scheme:0,signer:null,signature:signAuthorization(key,plan.sigHash())})]});if(tx.sigHash()!==plan.sigHash())throw Error('Signing changed transaction');return tx;}
export {createKey,preparePublicKey};
export function keyFromSeed(seed:Hex){return createKey(hexToBytes(seed));}
export async function submitAtomic(rpc:SidecarRpc,raw:Hex,onStatus:(s:string)=>void=()=>{}){
 const hash=decodeFrameTransaction(raw).transactionHash();
 const previous=await rpc.request<Parameters<typeof assertSuccessfulReceipt>[0]|null>('eth_getTransactionReceipt',[hash]);if(previous){assertSuccessfulReceipt(previous,3);return{hash,receipt:previous};}
 await submitToSidecar(rpc,raw);onStatus('Admitted to the alternative mempool. Waiting for confirmation…');
 for(let i=0;i<90;i++){
 const receipt=await rpc.request<Parameters<typeof assertSuccessfulReceipt>[0]|null>('eth_getTransactionReceipt',[hash]);
 if(receipt){assertSuccessfulReceipt(receipt,3);return{hash,receipt};}
 if(i>0&&i%15===0){const status=await rpc.request<{entry?:{status?:string}}>('skandha_explorer_getTransaction',[hash]);if(status?.entry?.status==='Cancelled')await submitToSidecar(rpc,raw);}
 await new Promise(r=>setTimeout(r,2000));
 }
 throw Error('Confirmation is pending. Keep this transaction and check its receipt before retrying.');
}
