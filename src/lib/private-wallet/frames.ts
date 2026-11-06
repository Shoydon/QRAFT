import {type Hex} from 'viem';
import {Frame,FrameTx} from '../../../packages/frame-account/src/frametx';
import {modularPlan} from '../atomic/modular';
import type {PQKey} from '../../../packages/pq-account/src/keys';
export function privateFramePlan(address:Hex,key:PQKey,nonce:bigint,validator:Hex,paymaster:Hex,pool:Hex,data:Hex,value=0n){
 const plan=modularPlan(address,key,nonce,validator,paymaster,pool,data,value);
 return new FrameTx({...plan,frames:[plan.frames[0]!,new Frame({...plan.frames[1]!,gasLimit:200000}),new Frame({...plan.frames[2]!,stateGasLimit:8000000})]});
}
