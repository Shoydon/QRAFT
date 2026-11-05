import {expect,test} from 'bun:test';
import {validatePublicStatement} from '../src/lib/pq/jobs';
import manifest from '../public/pq-deployment.json';
const statement=()=>({profile:manifest.profile,root:Array(64).fill(0),nullifier:Array(64).fill(0),context:Array(64).fill(0),publicContext:{chainIdHex:`0x${(8141).toString(16).padStart(64,'0')}`,poolHex:manifest.pool,recipientHex:`0x${'11'.repeat(20)}`,relayerHex:`0x${'00'.repeat(20)}`,denomination:manifest.denominationWei,fee:'0',deadline:'1800000000'}});
test('public encoder persistence boundary rejects nested secret and witness fields',()=>{
 for(const forbidden of ['secret','witness','seed']){const input=statement();Object.assign(input.publicContext,{[forbidden]:'must-never-be-persisted'});expect(()=>validatePublicStatement(input)).toThrow('fixed public');}
});
test('public encoder rejects extra top-level fields, malformed bytes and unsupported profiles',()=>{
 expect(()=>validatePublicStatement({...statement(),secret:'must-not-persist'})).toThrow();
 expect(()=>validatePublicStatement({...statement(),profile:'groth16'})).toThrow();
 const input=statement();input.root[0]=256;expect(()=>validatePublicStatement(input)).toThrow();
});
test('public context preserves exact byte widths, zero fee and fixed native-ETH deployment',()=>{
 const valid=statement();validatePublicStatement(valid);
 for(const field of ['chainIdHex','poolHex','recipientHex','relayerHex']as const){const input=statement();input.publicContext[field]='0x01';expect(()=>validatePublicStatement(input)).toThrow();}
 const fee=statement();fee.publicContext.fee='1';expect(()=>validatePublicStatement(fee)).toThrow();
});
