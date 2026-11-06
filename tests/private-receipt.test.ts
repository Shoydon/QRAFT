import {test,expect} from 'bun:test';
import {encodeAbiParameters,encodeEventTopics,type Hex} from 'viem';
import {assertPrivateSettlement} from '../src/lib/private-wallet/receipt';
import {privatePoolAbi} from '../src/lib/private-wallet/protocol';
import type {PqRawReceipt} from '../src/lib/pq/account';
const hex=(byte:string,length:number)=>('0x'+byte.repeat(length)) as Hex;
const expected={hash:hex('01',32),id:hex('02',32),pool:hex('03',20),paymaster:hex('04',20)};
const log={address:expected.pool,topics:encodeEventTopics({abi:privatePoolAbi,eventName:'Settled',args:{actionId:expected.id}}) as Hex[],data:encodeAbiParameters([{type:'uint8'},{type:'uint128'},{type:'uint128'},{type:'address'}],[1,0n,0n,hex('00',20)])};
const receipt:PqRawReceipt={type:'0x6',status:'0x1',payer:expected.paymaster,transactionHash:expected.hash,from:hex('05',20),blockNumber:'0x1',blockHash:hex('06',32),gasUsed:'0x123',frameReceipts:Array.from({length:3},()=>({status:'0x1' as Hex,gasUsed:'0x1' as Hex,logs:[]})),logs:[log]};
test('only the exact pool settlement and sponsor confirm a private payment',()=>{
 expect(()=>assertPrivateSettlement(receipt,expected)).not.toThrow();
 expect(()=>assertPrivateSettlement({...receipt,logs:[]},expected)).toThrow();
 expect(()=>assertPrivateSettlement({...receipt,logs:[{...log,address:hex('07',20)}]},expected)).toThrow();
 expect(()=>assertPrivateSettlement(receipt,{...expected,id:hex('08',32)})).toThrow();
 expect(()=>assertPrivateSettlement({...receipt,transactionHash:hex('09',32)},expected)).toThrow();
 expect(()=>assertPrivateSettlement({...receipt,payer:receipt.from},expected)).toThrow();
 expect(()=>assertPrivateSettlement({...receipt,frameReceipts:receipt.frameReceipts!.map((f,i)=>i===2?{...f,status:'0x0'}:f)},expected)).toThrow();
});

test('private payments reject non-EIP-8141 receipt types even with matching settlement logs',()=>{
 for(const type of ['0x0','0x1','0x2','0x3','0x4'] as Hex[])expect(()=>assertPrivateSettlement({...receipt,type},expected)).toThrow();
});
