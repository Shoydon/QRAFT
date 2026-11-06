import {isAddress,type Hex} from 'viem';
import {FIELD,MAX_AMOUNT,ENVELOPE_BYTES} from './model';
import type {PrivateAction,Four,Two} from './protocol';
import type {PrivateProof} from './prover';
export function paymentWire(action:PrivateAction,proof:PrivateProof){return JSON.parse(JSON.stringify({action,proof},(_,v)=>typeof v==='bigint'?String(v):v));}
export function parsePayment(value:unknown):{action:PrivateAction;proof:PrivateProof}{
 if(!value||typeof value!=='object')throw Error('Invalid payment');
 const v=value as Record<string,unknown>,a=v.action as Record<string,unknown>;
 const number=(x:unknown,max=FIELD-1n)=>{if(typeof x!=='string'||!/^\d{1,78}$/.test(x))throw Error('Invalid payment number');const n=BigInt(x);if(n>max)throw Error('Payment number out of range');return n;};
 const list=(x:unknown,length:number,max?:bigint)=>{if(!Array.isArray(x)||x.length!==length)throw Error('Invalid payment shape');return x.map(n=>number(n,max));};
 if(Object.keys(v).sort().join(',')!=='action,proof'||!a||Object.keys(a).sort().join(',')!=='deposit,envelopes,expiry,kind,nullifiers,outputs,recipient,root,withdrawal'||![0,1,2].includes(a.kind as number)||typeof a.recipient!=='string'||!isAddress(a.recipient))throw Error('Invalid payment action');
 if(!Array.isArray(a.envelopes)||a.envelopes.length!==2||a.envelopes.some(x=>typeof x!=='string'||!/^0x([0-9a-f]{2})*$/i.test(x)||(x!=='0x'&&x.length!==2+2*ENVELOPE_BYTES)))throw Error('Invalid encrypted payment');
 return{action:{root:number(a.root),kind:a.kind as number,deposit:number(a.deposit,MAX_AMOUNT),withdrawal:number(a.withdrawal,MAX_AMOUNT),recipient:a.recipient as Hex,expiry:number(a.expiry,(1n<<64n)-1n),nullifiers:list(a.nullifiers,4) as Four,outputs:list(a.outputs,2) as Two,envelopes:a.envelopes as [Hex,Hex]},proof:list(v.proof,8,(1n<<256n)-1n) as PrivateProof};
}
