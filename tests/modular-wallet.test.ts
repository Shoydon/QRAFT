import {test,expect} from 'bun:test';
import {keccak256,encodeFunctionData} from 'viem';
import {modularConfig,modularRuntime,predictModular,modularPlan} from '../src/lib/atomic/modular';
import {createKey,signAtomic,poolAbi} from '../src/lib/atomic/account';
import {FrameTx} from '../packages/frame-account/src/frametx';
import {verifyAuthorization} from '../packages/pq-account/src/keys';
const factory='0x1111111111111111111111111111111111111111',implementation='0x2222222222222222222222222222222222222222',validator='0x3333333333333333333333333333333333333333',pool='0x4444444444444444444444444444444444444444';
const commitment=keccak256('0x1234');
test('clone layout binds validator, key and implementation into its address',()=>{
 expect((modularConfig(validator,commitment).length-2)/2).toBe(55);
 expect((modularRuntime(implementation,validator,commitment).length-2)/2).toBe(100);
 const address=predictModular(factory,implementation,validator,commitment);
 expect(predictModular(factory,implementation,validator,keccak256('0x5678'))).not.toBe(address);
 expect(predictModular(factory,implementation,pool,commitment)).not.toBe(address);
 expect(predictModular(factory,pool,validator,commitment)).not.toBe(address);
});
test('PQ signature binds module selection as well as all frames',()=>{
 const key=createKey(new Uint8Array(32).fill(21));
 const plan=modularPlan(factory,key,0n,validator,implementation,pool,encodeFunctionData({abi:poolAbi,functionName:'deposit',args:[commitment]}),100000000000000n);
 const signed=signAtomic(plan,key);expect(signed.nonceKeys).toEqual([BigInt(validator)]);
 expect(verifyAuthorization(key.publicKey,signed.sigHash(),signed.signatures[0]!.signature)).toBe(true);
 const changed=new FrameTx({...signed,nonceKeys:[BigInt(pool)]});
 expect(verifyAuthorization(key.publicKey,changed.sigHash(),signed.signatures[0]!.signature)).toBe(false);
});
