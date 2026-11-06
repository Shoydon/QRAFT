/** Ordered atomic public-proof work. No private witness or wallet authorization. */
import {type Hex} from 'viem';
import {Frame,FrameSig,FrameTx,FrameMode,SigScheme,decodeFrameTransaction} from '../../../packages/frame-account/src/frametx';
export interface PublicFrameCall {to:Hex;data:Hex}
export interface PublicBatch {operator:Hex;nonceKey:bigint;nonce:bigint;calls:readonly PublicFrameCall[]}
/** Measure the envelope before raw() enforces its hard cap. The placeholder
 * signature has the same byte width as the eventual signature. */
export function publicBatchFitsRelay(tx:FrameTx):boolean {
  return 1+(tx.encode().length-2)/2<=130000;
}
export function publicBatchPlan({operator,nonceKey,nonce,calls}:PublicBatch,legacyBudgets=false):FrameTx {
  if(calls.length<1||calls.length>4)throw Error('Public batch must contain one to four calls.');
  const execution=calls.length>2?(legacyBudgets?2000000n:4000000n):calls.length===2?(legacyBudgets?8000000n:11000000n):14500000n;
  const state=calls.length===1?10000000n:calls.length===2&&!legacyBudgets?1300000n:calls.length>2&&!legacyBudgets?2000000n:3000000n;
  return new FrameTx({chainId:1337,nonceKeys:[nonceKey],nonceSeq:nonce,sender:operator,maxFee:128n,maxPriorityFee:1n,
    signatures:[new FrameSig({scheme:SigScheme.SECP256K1,signer:operator,signature:`0x${'00'.repeat(65)}`})],
    frames:[new Frame({mode:FrameMode.VERIFY,flags:3,target:operator,gasLimit:30000n,stateGasLimit:97920n}),
      ...calls.map((call,index)=>new Frame({mode:FrameMode.SENDER,flags:index<calls.length-1?4:0,target:call.to,data:call.data,gasLimit:execution,stateGasLimit:state}))]});
}
export function verifyPublicBatch(raw:Hex,operation:PublicBatch):FrameTx {
  const actual=decodeFrameTransaction(raw);const expected=publicBatchPlan(operation);
  // Preserve exact signed groups created before the measured execution/state rebalance.
  const legacy=publicBatchPlan(operation,true);
  if((actual.sigHash()!==expected.sigHash()&&actual.sigHash()!==legacy.sigHash())||actual.signatures.length!==1||actual.signatures[0]?.scheme!==SigScheme.SECP256K1||actual.signatures[0].signature.length!==132)throw Error('Saved public batch differs from the ordered program.');
  return actual;
}
