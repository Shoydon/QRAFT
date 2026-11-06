import{expect,test}from'bun:test';
import type{Hex}from'viem';
import{Frame,FrameTx,FrameMode}from'../packages/frame-account/src/frametx';
import{PqPoolClient,PQ_DEPLOYMENT,type PreparedPqWithdrawal}from'../src/lib/pq/pool';
import{createPqNote}from'../src/lib/pq/note';
import{pqPaymaster,type PqAccountClient,type PqRawReceipt}from'../src/lib/pq/account';
import type{ChainTransport}from'../src/lib/transport/types';
const owner=`0x${'11'.repeat(20)}`as Hex;
const oldHash=`0x${'33'.repeat(32)}`as Hex;
function scenario(){
 const note=createPqNote(PQ_DEPLOYMENT);const recipient=`0x${'44'.repeat(20)}`as Hex;
 const statement={profile:note.profile,root:Array(64).fill(0)as number[],nullifier:Array.from(Buffer.from(note.nullifier.slice(2),'hex')),context:Array(64).fill(1)as number[],publicContext:{chainIdHex:'0x'+(8141).toString(16).padStart(64,'0'),poolHex:note.pool,recipientHex:recipient,relayerHex:`0x${'00'.repeat(20)}`,denomination:note.denominationWei,fee:'0',deadline:'1800000000'}};
 const prepared:PreparedPqWithdrawal={jobId:'a'.repeat(64),note,recipient,deadline:1800000000n,statement,signal:new AbortController().signal};
 const receipt:PqRawReceipt={type:'0x6',status:'0x1',payer:pqPaymaster(),from:owner,transactionHash:oldHash,blockNumber:'0x1',blockHash:`0x${'55'.repeat(32)}`,gasUsed:'0x1',frameReceipts:Array.from({length:3},()=>({status:'0x1' as const,gasUsed:'0x1' as const,logs:[]})),logs:[]};
 const rpcCalls:string[]=[];
 const transport={request:async<T>(method:string)=>{rpcCalls.push(method);if(method==='eth_getTransactionReceipt')return receipt as T;if(method==='eth_getBlockByNumber')return{hash:receipt.blockHash}as T;throw Error('Unexpected recovery read');}}as ChainTransport;
 const pool=new PqPoolClient(transport);
 const state=pool as unknown as{verified:Promise<void>;flows:Map<string,unknown>};state.verified=Promise.resolve();
 state.flows.set(prepared.jobId,{owner,binding:JSON.stringify([statement.root,statement.nullifier,statement.context,recipient,String(prepared.deadline)]),nullifier:note.nullifier,recipient,deadline:String(prepared.deadline),attached:true,sessionId:`0x${'22'.repeat(32)}`,pending:'withdraw',pendingHash:oldHash});
 return{prepared,pool,rpcCalls,receipt};
}
test('a successful attach receipt cannot be reported as the pending withdrawal',async()=>{
 const{prepared,pool}=scenario();let reconciled=false;
 const account={address:owner,pending:null,reconcile:async()=>{reconciled=true;throw Error('No account intent should be reconciled');}}as unknown as PqAccountClient;
 await expect(pool.withdraw(account,prepared,()=>{})).rejects.toThrow('does not establish this exact PQ withdrawal');
 expect(reconciled).toBe(false);
});
test('another pending account intent is not consumed as a saved withdrawal',async()=>{
 const{prepared,pool,rpcCalls}=scenario();let reconciled=false;
 const tx=new FrameTx({chainId:8141,nonceKeys:[1],nonceSeq:0,sender:owner,maxFee:128,maxPriorityFee:1,frames:[new Frame({mode:FrameMode.VERIFY,flags:3,target:owner,gasLimit:180000,data:'0x'}),new Frame({mode:FrameMode.SENDER,target:PQ_DEPLOYMENT.pool,gasLimit:1000000,data:'0xdeadbeef'})]});
 const account={address:owner,pending:{hash:tx.transactionHash(),raw:tx.raw(),state:'unknown'},reconcile:async()=>{reconciled=true;throw Error('Unrelated intent must remain untouched');}}as unknown as PqAccountClient;
 await expect(pool.withdraw(account,prepared,()=>{})).rejects.toThrow('Another native intent');
 expect(reconciled).toBe(false);expect(rpcCalls).toEqual([]);
});
test('deposit reconciliation refuses a different pending hash without consuming it',async()=>{
 const {pool,prepared}=scenario();let reconciled=false;
 const account={pending:{hash:`0x${'88'.repeat(32)}`,raw:'0x'},reconcile:async()=>{reconciled=true;}}as unknown as PqAccountClient;
 await expect(pool.reconcileDeposit(account,prepared.note,oldHash,()=>{})).rejects.toThrow('frozen deposit intent');expect(reconciled).toBe(false);
});
test('a successful unrelated receipt cannot establish a deposit',()=>{
 const {pool,prepared,receipt}=scenario();
 expect(()=>pool.confirmDeposit({kind:'confirmed',hash:oldHash,receipt},prepared.note)).toThrow('does not establish this exact PQ deposit');
});
