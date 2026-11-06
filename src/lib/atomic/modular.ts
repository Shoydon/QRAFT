import {concat,encodePacked,getCreate2Address,type Hex} from 'viem';
import {Frame,FrameTx,nonceSlot,NONCE_MANAGER_LEGACY} from '../../../packages/frame-account/src/frametx';
import {atomicPlan} from './account';
import type {PQKey} from '../../../packages/pq-account/src/keys';
import type {SidecarRpc} from '../../../packages/frame-account/src/alt-mempool';
export function modularConfig(validator:Hex,commitment:Hex){return encodePacked(['address','uint8','uint8','uint8','bytes32'],[validator,2,15,0,commitment]);}
export function modularRuntime(implementation:Hex,validator:Hex,commitment:Hex){return concat(['0x363d3d373d3d3d363d73',implementation,'0x5af43d82803e903d91602b57fd5bf3',modularConfig(validator,commitment)]);}
export function predictModular(factory:Hex,implementation:Hex,validator:Hex,commitment:Hex){return getCreate2Address({from:factory,salt:commitment,bytecode:concat(['0x6100643d81600a3d39f3',modularRuntime(implementation,validator,commitment)])});}
export function modularPlan(address:Hex,key:PQKey,nonce:bigint,validator:Hex,paymaster:Hex,pool:Hex,data:Hex,value=0n){
 const plan=atomicPlan(address,key,nonce,paymaster,pool,data,value);
 return new FrameTx({...plan,nonceKeys:[BigInt(validator)],frames:[new Frame({...plan.frames[0]!,gasLimit:4500000}),new Frame({...plan.frames[1]!,gasLimit:150000}),plan.frames[2]!]});
}
export async function modularNonce(rpc:SidecarRpc,address:Hex,validator:Hex){return BigInt(await rpc.request<Hex>('eth_getStorageAt',[NONCE_MANAGER_LEGACY,nonceSlot(address,BigInt(validator)),'latest']));}
