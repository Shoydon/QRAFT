import {decodeEventLog,type Hex} from 'viem';
import {assertSuccessfulReceipt} from '../../../packages/frame-account/src/frametx';
import type {PqRawReceipt} from '../pq/account';
import {privatePoolAbi} from './protocol';
export function assertPrivateSettlement(receipt:PqRawReceipt,expected:{hash:Hex;id:Hex;pool:Hex;paymaster:Hex}){
 if(receipt.transactionHash.toLowerCase()!==expected.hash.toLowerCase())throw Error('Receipt transaction mismatch');
 assertSuccessfulReceipt(receipt,3);
 if(receipt.payer?.toLowerCase()!==expected.paymaster.toLowerCase())throw Error('Payment receipt used a different gas sponsor');
 const settled=receipt.logs.some(log=>{
  if(log.address.toLowerCase()!==expected.pool.toLowerCase())return false;
  try{const event=decodeEventLog({abi:privatePoolAbi,data:log.data,topics:log.topics as [Hex,...Hex[]]});return event.eventName==='Settled'&&event.args.actionId===expected.id;}catch{return false;}
 });
 if(!settled)throw Error('Receipt does not confirm this payment. Keep the pending payment and check again.');
}
