import {bytesToHex,encodeFunctionData,isAddress,keccak256,parseAbi,type Hex} from 'viem';
import {decodeFrameTransaction,nonceSlot,NONCE_MANAGER_LEGACY} from '../../../packages/frame-account/src/frametx';
import {createKey,preparePublicKey,signAtomic,submitAtomic} from '../atomic/account';
import {modularNonce,predictModular} from '../atomic/modular';
import type {VaultSession} from '../pq/vault';
import {derivePrivateKeys,decodePrivateAddress,encodePrivateAddress,type PrivateKeys} from './crypto';
import {deploymentDomain,type PrivateDeployment} from './deployment';
import {discoverPrivateWallet,type PrivateRpc,type PrivateSnapshot} from './discovery';
import {privateFramePlan,privateProofFramePlan,privateFactoryPlan} from './frames';
import {selectNotes} from './planner';
import {actionDigest,buildPrivateAction,privatePoolAbi} from './protocol';
import {provePrivate} from './prover';
import {decryptLocal,encryptLocal,erasePrivateKeys} from './vault';
import {parsePayment,paymentWire} from './wire';
import {assertPrivateSettlement} from './receipt';
import type {PqRawReceipt} from '../pq/account';
interface Intent {expiry:string;commitments:string[];description:string;payment?:ReturnType<typeof paymentWire>;raw?:Hex;hash?:Hex;id?:Hex}
export type PaymentKind='shield'|'send'|'withdraw'|'combine';
export class PrivateWalletEngine{
 readonly domain;readonly address:Hex;readonly receivingAddress:string;readonly storage:string;
 snapshot:PrivateSnapshot|null=null;publicBalance:bigint|null=null;intent:Intent|null=null;quarantineUntil=0n;
 private refreshing:Promise<void>|null=null;private verified=false;
 private syncState:'idle'|'loading'|'ready'|'error'='idle';
 private syncListeners=new Set<()=>void>();
 subscribeSync=(listener:()=>void)=>{this.syncListeners.add(listener);return()=>{this.syncListeners.delete(listener);};};
 getSyncState=()=>this.syncState;
 private publishSync(state:typeof this.syncState){this.syncState=state;for(const listener of this.syncListeners)listener();}
 private controller=new AbortController();
 readonly rpc:PrivateRpc;
 constructor(readonly manifest:PrivateDeployment,readonly keys:PrivateKeys,readonly session:VaultSession,rpc:PrivateRpc,readonly status:(s:string)=>void){
  this.rpc={request:async<T>(method:string,params:unknown[]=[]):Promise<T>=>{
   for(let attempt=0;;attempt++){
    if(this.controller.signal.aborted)throw Error('Wallet locked');
    try{return await rpc.request<T>(method,params);}catch(error){
     if(attempt>=2||method.startsWith('eth_send')||method.startsWith('skandha_'))throw error;
     if(error instanceof Error&&/timed out|timeout|network|failed to fetch/i.test(error.message))rpc.reconnect?.();
     status(`Network read interrupted. Retrying ${attempt+2} of 3`);await new Promise(r=>setTimeout(r,500));
    }
   }
  }};
  this.domain=deploymentDomain(manifest);this.receivingAddress=encodePrivateAddress(this.domain,keys);this.storage='qraft:private:intent:v1:'+this.domain.pool+':'+keys.owner;
  const key=createKey(keys.signingSeed),commitment=keccak256(bytesToHex(preparePublicKey(key.publicKey).subarray(1)));key.seed.fill(0);
  this.address=predictModular(manifest.contracts.factory.address,manifest.contracts.implementation.address,manifest.contracts.validator.address,commitment);
 }
 get available(){const reserved=new Set(this.intent?.commitments??[]);return this.snapshot?.notes.filter(n=>!reserved.has(String(n.commitment))).reduce((s,n)=>s+n.amount,0n)??null;}
 async load(){const saved=localStorage.getItem(this.storage);this.intent=saved?await decryptLocal<Intent>(saved,this.session):null;this.quarantineUntil=BigInt(localStorage.getItem(this.storage+':recovery')??'0');}
 resetRecoveredJournal(){
  const previous=localStorage.getItem(this.storage);
  if(previous)localStorage.setItem(this.storage+':before-recovery:'+Date.now(),previous);
  localStorage.removeItem(this.storage);this.intent=null;
 }
 private async save(){if(this.intent)localStorage.setItem(this.storage,await encryptLocal(this.intent,this.session));else localStorage.removeItem(this.storage);}
 private async confirmReceipt(receipt:PqRawReceipt,hash:Hex){
  if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('Receipt transaction mismatch');
  const canonical=await this.rpc.request<{hash:Hex}>('eth_getBlockByNumber',[receipt.blockNumber,false]);
  if(canonical.hash!==receipt.blockHash)throw Error('Payment confirmation changed. Check again.');
  const head=BigInt(await this.rpc.request<Hex>('eth_blockNumber'));
  if(head<=BigInt(receipt.blockNumber))throw Error('Payment included. Waiting for one more block before confirming.');
  // Only the exact locally journaled transaction is classified as failed.
  if(this.intent?.raw&&(BigInt(receipt.status)!==1n||receipt.frameReceipts?.some(f=>BigInt(f.status)!==1n))){this.intent=null;await this.save();throw Error('Payment was included but failed. Your private balance has been refreshed; you can try again.');}
  if(!this.intent?.id)throw Error('Missing saved payment identity');
  assertPrivateSettlement(receipt,{hash,id:this.intent.id,pool:this.domain.pool,paymaster:this.manifest.contracts.paymaster.address});
 }
 async quarantine(){const head=await this.rpc.request<{timestamp:Hex}>('eth_getBlockByNumber',['latest',false]);this.quarantineUntil=BigInt(head.timestamp)+300n;localStorage.setItem(this.storage+':recovery',String(this.quarantineUntil));}
 async refresh(){if(this.refreshing)return this.refreshing;this.publishSync('loading');this.refreshing=this.sync();try{await this.refreshing;this.publishSync('ready');}catch(error){this.publishSync('error');throw error;}finally{this.refreshing=null;}}
 private async sync(){
  this.status('Syncing your private balance');
  if(!this.verified){
   const chain=BigInt(await this.rpc.request<Hex>('eth_chainId')),genesis=await this.rpc.request<{hash:Hex}>('eth_getBlockByNumber',['0x0',false]);
   if(chain!==BigInt(this.domain.chainId)||genesis.hash!==this.domain.genesisHash)throw Error('Private wallet network identity mismatch');
   for(const name of ['pool','proofAccount','paymaster','implementation','validator','factory'] as const){const pin=this.manifest.contracts[name];const code=await this.rpc.request<Hex>('eth_getCode',[pin.address,'latest']);if(keccak256(code)!==pin.runtimeHash)throw Error('Contract code does not match the pinned deployment: '+name);}this.verified=true;
  }
  const snapshot=await discoverPrivateWallet(this.rpc,this.domain,this.keys,this.status,BigInt(this.manifest.fromBlock),this.controller.signal);
  this.snapshot=snapshot;
  this.status(snapshot.pendingBalance?'Incoming payment confirming':'Balance up to date');
 }
 async refreshPublic(){this.publicBalance=BigInt(await this.rpc.request<Hex>('eth_getBalance',[this.address,'latest']));}
 async pay(kind:PaymentKind,amount:bigint,recipient:string){
  if(!navigator.locks)throw Error('This browser cannot safely coordinate wallet payments');
  return navigator.locks.request(this.storage,{ifAvailable:true},async lock=>{
   if(!lock)throw Error('This wallet is preparing a payment in another tab');
   await this.load();if(this.intent)throw Error('Check your pending payment first');
   await this.refresh();const snapshot=this.snapshot!;
   if(snapshot.timestamp<=this.quarantineUntil)throw Error('Recovery safety check is still running. Wait five minutes, then refresh.');
   if(kind!=='combine'&&amount<=0n)throw Error('Enter an amount greater than zero');
   const self=decodePrivateAddress(this.receivingAddress,this.domain);
   const selection=kind==='shield'?null:kind==='combine'?{inputs:snapshot.notes.slice().sort((a,b)=>a.amount<b.amount?-1:1).slice(0,4),change:0n,consolidationRequired:false}:selectNotes(snapshot.notes,amount,new Set());
   if(selection?.consolidationRequired)throw Error('This amount needs your smaller payments combined first. Use Combine balance, then review this payment again.');
   if(kind==='combine'&&selection!.inputs.length<2)throw Error('Your balance is already ready to spend');
   if(kind==='withdraw'&&(!isAddress(recipient)||/^0x0{40}$/i.test(recipient)||recipient.toLowerCase()===this.domain.pool.toLowerCase()))throw Error('Enter a valid public Ethereum address');
   if(kind==='shield'){
    await this.refreshPublic();
    if(amount>this.publicBalance!)throw Error('Insufficient public ETH. Fund your public address first.');
    const code=await this.rpc.request<Hex>('eth_getCode',[this.address,'latest']);
    const ready=code!=='0x'&&BigInt(await this.rpc.request<Hex>('eth_call',[{to:this.address,data:encodeFunctionData({abi:parseAbi(['function setupComplete() view returns(bool)']),functionName:'setupComplete'})},'latest']))===1n;
    if(!ready){
     this.status('Preparing your ERC-8286 PQ account: setup sponsored by QRAFT');
     const setupStorage=this.storage+':setup';let stored=localStorage.getItem(setupStorage);
     if(stored){const previous=await decryptLocal<{raw:Hex}>(stored,this.session);const receipt=await this.rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[decodeFrameTransaction(previous.raw).transactionHash()]);if(receipt&&(BigInt(receipt.status)!==1n||receipt.frameReceipts?.some(f=>BigInt(f.status)!==1n))){const canonical=await this.rpc.request<{hash:Hex}>('eth_getBlockByNumber',[receipt.blockNumber,false]);if(canonical.hash!==receipt.blockHash)throw Error('Account setup confirmation changed');localStorage.setItem(setupStorage+':last-failed',stored);localStorage.removeItem(setupStorage);stored=null;}}
     let setup: {raw:Hex};
     if(stored)setup=await decryptLocal<{raw:Hex}>(stored,this.session);
     else{
      const key=createKey(this.keys.signingSeed);
      try{const initial=privateFactoryPlan(this.manifest.contracts.factory.address,key,this.manifest.contracts.paymaster.address);const nonce=BigInt(await this.rpc.request<Hex>('eth_getStorageAt',[NONCE_MANAGER_LEGACY,nonceSlot(initial.sender,initial.nonceKeys[0]!),'latest']));const tx=signAtomic(privateFactoryPlan(this.manifest.contracts.factory.address,key,this.manifest.contracts.paymaster.address,nonce),key);setup={raw:tx.raw()};localStorage.setItem(setupStorage,await encryptLocal(setup,this.session));}finally{key.seed.fill(0);}
     }
     await submitAtomic(this.rpc,setup.raw,this.status);localStorage.removeItem(setupStorage);
     this.publicBalance=BigInt(await this.rpc.request<Hex>('eth_getBalance',[this.address,'latest']));
    }

   }
   const outputs=kind==='shield'?[{recipient:self,amount}]:kind==='combine'?[{recipient:self,amount:selection!.inputs.reduce((s,n)=>s+n.amount,0n)}]:[
    ...(kind==='send'?[{recipient:decodePrivateAddress(recipient,this.domain),amount}]:[]),
    ...(selection!.change>0n?[{recipient:self,amount:selection!.change}]:[]),
   ];
   // Read time after provisioning, which can take longer than a proof's lifetime.
   const block=await this.rpc.request<{timestamp:Hex}>('eth_getBlockByNumber',['latest',false]);
   const built=await buildPrivateAction({domain:this.domain,keys:this.keys,tree:snapshot.tree,inputs:selection?.inputs??[],outputs,kind:kind==='shield'?0:kind==='withdraw'?2:1,deposit:kind==='shield'?amount:0n,withdrawal:kind==='withdraw'?amount:0n,recipient:kind==='withdraw'?recipient as Hex:undefined,expiry:BigInt(block.timestamp)+240n});
   this.intent={expiry:String(built.action.expiry),commitments:(selection?.inputs??[]).map(n=>String(n.commitment)),description:kind==='combine'?'Combine balance':kind==='shield'?'Add to private balance':kind==='withdraw'?'Withdraw to public address':'Private payment'};
   await this.save();
   const proof=await provePrivate(built.witness,built.signals,this.status,this.controller.signal);this.intent.payment=paymentWire(built.action,proof);this.intent.id=actionDigest(this.domain,built.action);await this.save();
   if(kind==='shield'){
    const key=createKey(this.keys.signingSeed);
    try{const nonce=await modularNonce(this.rpc,this.address,this.manifest.contracts.validator.address);const data=encodeFunctionData({abi:privatePoolAbi,functionName:'transact',args:[built.action,proof]});const signed=signAtomic(privateFramePlan(this.address,key,nonce,this.manifest.contracts.validator.address,this.manifest.contracts.paymaster.address,this.domain.pool,data,amount),key);this.intent.raw=signed.raw();this.intent.hash=signed.transactionHash();await this.save();}finally{key.seed.fill(0);}
   }else{
    const data=encodeFunctionData({abi:privatePoolAbi,functionName:'transact',args:[built.action,proof]});
    const tx=privateProofFramePlan(this.manifest.contracts.proofAccount.address,this.manifest.contracts.paymaster.address,this.domain.pool,data,this.intent.id!);
    this.intent.raw=tx.raw();this.intent.hash=tx.transactionHash();await this.save();
   }
   return this.submit();
  });
 }
 private async submit():Promise<Hex>{
  if(!this.intent?.payment)throw Error('Preparation was interrupted. Refresh after the safety timer expires.');
  if(!this.intent.raw)throw Error('Transaction preparation was interrupted. Wait for its safety timer to expire.');
  this.status('Submitting your transaction through Nym Anon RPC');
  const hash=(await submitAtomic(this.rpc,this.intent.raw,this.status)).hash;
  // A submission result alone is insufficient: check the canonical chain receipt.
  const receipt=await this.rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[hash]);if(!receipt)throw Error('Submitted. Confirmation is still pending; check this payment again.');await this.confirmReceipt(receipt,hash);
  this.intent=null;await this.save();await this.refresh();this.status('Payment confirmed');return hash;
 }
 async reconcile(){
  return navigator.locks.request(this.storage,{ifAvailable:true},async lock=>{
   if(!lock)throw Error('A payment is active in another tab');await this.load();if(!this.intent)return;
   await this.refresh();
   const discovered=this.intent.id?this.snapshot!.settlements.get(this.intent.id):undefined;
   if(discovered){const receipt=await this.rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[discovered]);if(receipt){await this.confirmReceipt(receipt,discovered);this.intent=null;await this.save();this.status('Payment confirmed');return discovered;}}
   if(this.intent.hash){const receipt=await this.rpc.request<PqRawReceipt|null>('eth_getTransactionReceipt',[this.intent.hash]);if(receipt){const hash=this.intent.hash;await this.confirmReceipt(receipt,hash);this.intent=null;await this.save();this.status('Payment confirmed');return hash;}}
   if(this.snapshot!.timestamp>BigInt(this.intent.expiry)+30n){
    // Proof is now invalid even if the network still holds it. A fresh snapshot
    // determines whether its inputs were spent before expiry.
    // Preserve the terminal signed intent for diagnosis. Once expiry passed,
    // its pool call cannot move value even if the action nonce is still free.
    localStorage.setItem(this.storage+':last-expired',await encryptLocal(this.intent,this.session));
    this.intent=null;await this.save();this.status('Balance checked. You can prepare a new payment.');return;
   }
   if(this.intent.payment){const {action}=parsePayment(this.intent.payment);if(action.kind===0&&!this.intent.raw)throw Error('Deposit preparation interrupted. Wait for its safety timer to expire.');return this.submit();}
   throw Error('Preparation interrupted. Funds stay reserved until the proof safety timer expires.');
  });
 }
 lock(){this.controller.abort();erasePrivateKeys(this.keys);this.snapshot=null;this.publicBalance=null;}
}
export {derivePrivateKeys};
