import {bytesToHex,encodeAbiParameters,encodeFunctionData,keccak256,parseAbi,type Hex} from 'viem';
import {Frame,FrameTx} from '../../../packages/frame-account/src/frametx';
import {modularPlan} from '../atomic/modular';
import {preparePublicKey,type PQKey} from '../../../packages/pq-account/src/keys';
export function privateFramePlan(address:Hex,key:PQKey,nonce:bigint,validator:Hex,paymaster:Hex,pool:Hex,data:Hex,value=0n){
 const plan=modularPlan(address,key,nonce,validator,paymaster,pool,data,value);
 return new FrameTx({...plan,frames:[plan.frames[0]!,new Frame({...plan.frames[1]!,gasLimit:200000}),new Frame({...plan.frames[2]!,stateGasLimit:8000000})]});
}

/** No signing key: the shared account validates the exact pool action proof. */
export function privateProofFramePlan(account:Hex,paymaster:Hex,pool:Hex,data:Hex,id:Hex){
 if(BigInt(id)===0n)throw Error('Invalid private action nonce');
 return new FrameTx({chainId:1337,sender:account,nonceKeys:[BigInt(id)],nonceSeq:0,maxFee:128,maxPriorityFee:1,frames:[
  new Frame({mode:1,flags:2,target:account,gasLimit:1500000,data:'0xfc735e99'}),
  new Frame({mode:1,flags:1,target:paymaster,gasLimit:200000,stateGasLimit:97920,data:'0x1b9265b8'}),
  new Frame({mode:2,target:pool,gasLimit:3000000,stateGasLimit:8000000,data}),
 ]});
}

export function privateFactoryPlan(account:Hex,key:PQKey,paymaster:Hex,nonce=0n){
 const prepared=bytesToHex(preparePublicKey(key.publicKey).subarray(1));
 const commitment=keccak256(prepared);
 const nonceKey=keccak256(encodeAbiParameters([{type:'string'},{type:'uint256'},{type:'address'},{type:'bytes32'}],['QRAFT_FACTORY_V1',1337n,account,commitment]));
 const base=privateFramePlan(account,key,nonce,account,paymaster,account,'0x');
 return new FrameTx({...base,nonceKeys:[BigInt(nonceKey)],frames:[base.frames[0]!,base.frames[1]!,new Frame({mode:2,target:account,gasLimit:2000000,stateGasLimit:8000000,data:encodeFunctionData({abi:parseAbi(['function create(bytes32 commitment)']),functionName:'create',args:[commitment]})})]});
}
