'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {bytesToHex,hexToBytes,encodeFunctionData,isAddress,keccak256,type Hex} from 'viem';
import manifest from '../../public/atomic-deployment.json';
import modular from '../../public/modular-deployment.json';
import {modularPlan,modularNonce,predictModular} from '@/lib/atomic/modular';
import {preparePublicKey} from '../../packages/pq-account/src/keys';
import {Button,Card,Mono,Row,RowGroup,StatusLine,ToneIcon} from './primitives';
import {Sheet} from './Sheet';
import {ChevronIcon,CopyIcon,DownloadIcon,LockIcon,Spinner} from './icons';
import {Brand} from './Logo';
import {formatEth,truncateMiddle} from '@/lib/format';
import {browserPageTransport} from '@/lib/transport/page-transport';
import {createKey,atomicPlan,signAtomic,submitAtomic,poolAbi} from '@/lib/atomic/account';
import {createNote,parseNote,type AtomicNote} from '@/lib/atomic/note';
import {proofInput,proveInBrowser} from '@/lib/atomic/proof';
import {registerWalletPasskey,sealWallet,unlockWalletVault,parseWalletVault,parseWalletSecrets,type WalletVault,type WalletSecrets} from '@/lib/pq/vault';
const STORAGE='qraft:atomic:wallets:v1';
const JOURNAL='qraft:atomic:intent:v1';
interface SavedWallet{name:string;vault:WalletVault}
const pin=(name:keyof typeof manifest.contracts)=>manifest.contracts[name].address as Hex;
function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function AtomicApp(){
 const [wallets,setWallets]=useState<SavedWallet[]>([]),[active,setActive]=useState<WalletSecrets|null>(null),[walletOpen,setWalletOpen]=useState(false);
 const [tab,setTab]=useState<'deposit'|'withdraw'>('deposit'),[note,setNote]=useState<AtomicNote|null>(null),[text,setText]=useState(''),[recipient,setRecipient]=useState('');
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[receipt,setReceipt]=useState<Hex|null>(null),[progress,setProgress]=useState(false),[network,setNetwork]=useState('Connecting to Nym'),[balance,setBalance]=useState<{address:Hex;value:string}|null>(null);
 const [walletSetup,setWalletSetup]=useState(false);
 const [pending,setPending]=useState<Hex|null>(null),[deployment,setDeployment]=useState<Hex|null>(null);
 useEffect(()=>{
 const transport=browserPageTransport();transport?.start();const off=transport?.subscribe(s=>setNetwork(s.phase==='ready'?'Nym ready':s.detail??'Connecting to Nym'));
 queueMicrotask(()=>{try{const saved=JSON.parse(localStorage.getItem(STORAGE)??'[]') as SavedWallet[];setWallets(saved.map(w=>({...w,vault:parseWalletVault(JSON.stringify(w.vault))})));const intent=localStorage.getItem(JOURNAL);if(intent)setPending(JSON.parse(intent).raw);}catch{setError('Saved wallet data could not be read. Import your backup.');}});
 return()=>off?.();
 },[]);
 const nymReady=network==='Nym ready';
 useEffect(()=>{
 let current=true;const transport=browserPageTransport();const address=active?.address;
 if(!address||!transport||!nymReady)return;
 void transport.request<Hex>('eth_getBalance',[address,'latest']).then(value=>{if(current)setBalance({address,value:formatEth(BigInt(value))});}).catch(()=>{});
 return()=>{current=false;};
 // Only a settled transport triggers the read, so this cannot drive a reboot loop.
 },[active?.address,nymReady]);
 const rpc=()=>{const transport=browserPageTransport();if(!transport)throw Error('Browser transport unavailable');return transport;};
 // Mixnet round-trips fail intermittently; these reads are idempotent, so one slow
 // circuit should not end the whole transaction.
 const read=async<T,>(label:string,method:string,params:unknown[]):Promise<T>=>{
 let last:unknown;
 for(let attempt=1;attempt<=3;attempt++){
 setStatus(attempt===1?label:`${label} — retry ${attempt} of 3`);
 try{return await rpc().request<T>(method,params);}catch(failure){last=failure;}
 }
 throw last instanceof Error?last:Error('The anonymous read did not complete.');
 };
 const save=(next:SavedWallet[])=>{localStorage.setItem(STORAGE,JSON.stringify(next));setWallets(next);};
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Operation failed');}finally{setBusy(false);}};
 const connect=async(w:SavedWallet)=>run(async()=>{
 setStatus('Unlocking wallet');const unlocked=await unlockWalletVault(w.vault);let secrets=unlocked.secrets;
 if(secrets.chainId!==1337||secrets.genesisHash!==manifest.genesisHash)throw Error('This wallet belongs to another network');
 if(!secrets.address){
 setDeployment(null);setWalletSetup(true);setStatus('Checking ERC-8286 wallet deployment');setProgress(true);
 const response=await fetch('/api/atomic/wallet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publicKey:secrets.publicKey})});const result=await response.json();if(!response.ok)throw Error(result.error);
 secrets={...secrets,address:result.address};const vault=await sealWallet(secrets,unlocked.session);save(wallets.map(a=>a.vault.publicKey===secrets.publicKey?{...a,vault}:a));setDeployment(result.hash);setStatus('Wallet deployed');
 }
 setActive(secrets);setWalletOpen(false);
 });
 const create=()=>run(async()=>{
 setStatus('Generating PQ keypair');const key=createKey();
 const session=await registerWalletPasskey();
 let secrets:WalletSecrets={version:1,algorithm:'ML-DSA-44',chainId:1337,genesisHash:manifest.genesisHash as Hex,publicKey:bytesToHex(key.publicKey),seed:bytesToHex(key.seed),address:null};
 key.seed.fill(0);
 // Persist encrypted recovery material before spending gas on deployment.
 const saved:SavedWallet={name:`Wallet ${wallets.length+1}`,vault:await sealWallet(secrets,session)};save([...wallets,saved]);
 setDeployment(null);setWalletSetup(true);setStatus('Deploying your ERC-8286 wallet');setProgress(true);
 const response=await fetch('/api/atomic/wallet',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publicKey:secrets.publicKey})});const result=await response.json();if(!response.ok)throw Error(result.error);
 secrets={...secrets,address:result.address};saved.vault=await sealWallet(secrets,session);save([...wallets,saved]);setActive(secrets);setDeployment(result.hash);setStatus('Wallet deployed');setWalletOpen(false);
 });
 const importWallet=async(file:File)=>run(async()=>{
 const content=await file.text();let vault:WalletVault;
 try{vault=parseWalletVault(content);}catch{const secrets=parseWalletSecrets(content);if(secrets.chainId!==1337)throw Error('Wrong wallet network');vault=await sealWallet(secrets,await registerWalletPasskey());}
 if(vault.chainId!==1337||vault.genesisHash!==manifest.genesisHash)throw Error('This wallet belongs to another network');
 if(wallets.some(w=>w.vault.publicKey===vault.publicKey))throw Error('Wallet already saved');save([...wallets,{name:`Wallet ${wallets.length+1}`,vault}]);
 });
 const send=async(data:Hex,value=0n)=>{
 if(!active?.address)throw Error('Connect PQ wallet');if(pending)throw Error('Check the pending transaction first');
 setStatus('Preparing wallet authorization and sponsored pool frames');
 const key=createKey(hexToBytes(active.seed));
 const commitment=keccak256(bytesToHex(preparePublicKey(key.publicKey).subarray(1)));
 const isModular=active.address.toLowerCase()===predictModular(modular.contracts.factory.address as Hex,modular.contracts.implementation.address as Hex,modular.contracts.validator.address as Hex,commitment).toLowerCase();
 const nonce=isModular?await modularNonce({request:<T,>(method:string,params:unknown[]=[])=>read<T>('Reading the account nonce through anonymous RPC',method,params)},active.address,modular.contracts.validator.address as Hex):BigInt(await read<Hex>('Reading the account nonce through anonymous RPC','eth_getTransactionCount',[active.address,'latest']));
 const plan=isModular?modularPlan(active.address,key,nonce,modular.contracts.validator.address as Hex,modular.contracts.paymaster.address as Hex,pin('pool'),data,value):atomicPlan(active.address,key,nonce,pin('paymaster'),pin('pool'),data,value);
 const signed=signAtomic(plan,key);key.seed.fill(0);
 localStorage.setItem(JOURNAL,JSON.stringify({raw:signed.raw(),hash:signed.transactionHash()}));setPending(signed.raw());
 setStatus('Submitting through Nym to the alternative mempool');
 const result=await submitAtomic(rpc(),signed.raw(),setStatus);setReceipt(result.hash);setStatus('Confirmed');localStorage.removeItem(JOURNAL);setPending(null);
 };
 const transact=()=>run(async()=>{
 setWalletSetup(false);setProgress(true);setReceipt(null);setDeployment(null);
 if(tab==='deposit'){if(!note)throw Error('Save a deposit note first');await send(encodeFunctionData({abi:poolAbi,functionName:'deposit',args:[note.commitment]}),BigInt(manifest.denominationWei));setNote(null);}
 else{
 if(!isAddress(recipient))throw Error('Enter a valid recipient address');const imported=parseNote(text,pin('pool'),manifest.denominationWei);
 // A spent nullifier can never withdraw, so check before minutes of proving are spent on it.
 const spent=await read<Hex>('Reading the pool through anonymous RPC','eth_call',[{to:pin('pool'),data:encodeFunctionData({abi:poolAbi,functionName:'spent',args:[imported.nullifierHash]})},'latest']);
 if(BigInt(spent)!==0n)throw Error('This note has already been withdrawn.');
 const block=await read<{timestamp:Hex}>('Reading the chain head through anonymous RPC','eth_getBlockByNumber',['latest',false]);const expiry=BigInt(block.timestamp)+3600n;
 const {root,input}=await proofInput(rpc(),imported,recipient as Hex,expiry);const words=await proveInBrowser(input,setStatus);
 await send(encodeFunctionData({abi:poolAbi,functionName:'withdraw',args:[root,imported.nullifierHash,recipient as Hex,expiry,words]}));
 }
 });
 const discard=()=>{localStorage.removeItem(JOURNAL);setPending(null);setError('');setStatus('');setProgress(false);};
 const reconcile=()=>run(async()=>{
 if(!pending)return;setWalletSetup(false);setProgress(true);
 let saved:{hash?:Hex}={};try{saved=JSON.parse(localStorage.getItem(JOURNAL)??'{}') as {hash?:Hex};}catch{}
 try{const result=await submitAtomic(rpc(),pending,setStatus);setReceipt(result.hash);setPending(null);localStorage.removeItem(JOURNAL);setStatus('Confirmed');}
 catch(failure){
 const receipt=saved.hash?await rpc().request<unknown>('eth_getTransactionReceipt',[saved.hash]).catch(()=>null):null;
 if(!receipt)throw failure;
 setPending(null);localStorage.removeItem(JOURNAL);setStatus('');
 throw Error('The saved transaction was included but did not succeed. It has been cleared, so you can try again.');
 }
 });
 const copy=(value:string)=>navigator.clipboard.writeText(value);
 const lock=()=>{setActive(null);setBalance(null);};
 const activeWallet=wallets.find(w=>w.vault.publicKey===active?.publicKey);
 const walletBalance=balance&&active?.address&&balance.address===active.address?balance.value:null;
 const rowAction="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-60 transition-colors duration-[120ms] hover:bg-rule/60 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
 const explorer=(hash:Hex)=><a className="text-sm underline underline-offset-4" target="_blank" rel="noreferrer" href={`${manifest.explorerUrl}/tx/${hash}`}>View on explorer ↗</a>;
 return <main className="min-h-screen px-6 pb-6 pt-6 text-ink sm:px-10 sm:pt-8 lg:px-16">
 <header className="mx-auto flex w-full max-w-[80rem] items-center justify-between"><Link href="/" aria-label="QRAFT home"><Brand/></Link>
 <div className="flex min-w-0 items-center gap-3">{active&&<Mono className="hidden shrink-0 text-ink-60 sm:inline">{walletBalance===null?'—':`${walletBalance} ETH`}</Mono>}
 <Button variant="primary" onClick={()=>setWalletOpen(true)}>{active?`${activeWallet?.name??'PQ wallet'} · ${active.address?truncateMiddle(active.address):'Deployment pending'}`:'Connect wallet'}</Button></div></header>
 <div role="tablist" aria-label="Pool action" className="mx-auto mt-12 flex max-w-sm justify-center gap-10 border-b border-rule">{(['deposit','withdraw'] as const).map(t=>
 <button key={t} type="button" role="tab" aria-selected={tab===t} disabled={busy}
 className={`relative -mb-px px-1 pb-3 text-sm font-medium tracking-[-0.01em] transition-colors duration-[120ms] disabled:cursor-not-allowed ${tab===t?'text-ink':'text-ink-60 hover:text-ink'}`}
 onClick={()=>{setTab(t);setReceipt(null);}}>{t==='deposit'?'Deposit':'Withdraw'}
 {tab===t&&<span aria-hidden="true" className="spectral-bar absolute inset-x-0 bottom-0 h-[2px] rounded-full"/>}
 </button>)}</div>
 <Card className="mx-auto mt-12 max-w-xl p-7 sm:p-10"><h1 className="mb-6 text-2xl font-semibold">{tab==='deposit'?'Deposit ETH':'Withdraw ETH'}</h1>
 <p className="mb-8 text-5xl font-semibold">0.0001 <span className="text-2xl text-ink-60">ETH</span></p>
 {tab==='deposit'?<div className="space-y-4"><Button className="w-full" disabled={busy||!!pending} onClick={()=>{const n=createNote(pin('pool'),manifest.denominationWei);setNote(n);download('qraft-note.json',JSON.stringify(n,null,2));}}>Save {note?'another':'your'} private note</Button></div>:<div className="space-y-4">
 <label className="block text-sm">Private note<textarea aria-label="Private note" className="mt-2 w-full rounded-xl bg-sunk p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20" rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder="Paste your private note" /></label>
 <label className="block cursor-pointer text-sm underline">Or choose a note file<input className="sr-only" type="file" onChange={e=>{const f=e.target.files?.[0];if(f)void f.text().then(setText);}} /></label>
 <label className="block text-sm">Recipient address<input aria-label="Recipient address" className="mt-2 w-full rounded-xl bg-sunk p-3 focus:outline-none focus:ring-2 focus:ring-ink/20" placeholder="0x…" value={recipient} onChange={e=>setRecipient(e.target.value)} /></label>
 </div>}
 <RowGroup><Row label="Gas">QRAFT paymaster</Row><Row label="Wallet signature">ML-DSA-44</Row><Row label="Withdrawal proof">Groth16 · BN254</Row></RowGroup>
 <Button variant="primary" className="w-full" busy={busy} disabled={!active?.address||!!pending||(tab==='deposit'?!note:!text||!isAddress(recipient))} onClick={transact}>{!active?'Connect PQ wallet':tab==='deposit'?'Deposit 0.0001 ETH':'Withdraw 0.0001 ETH'}</Button>
 {pending&&<><Button className="mt-3 w-full" busy={busy} onClick={reconcile}>Check pending transaction</Button>
 <Button variant="ghost" className="mt-2 w-full" disabled={busy} onClick={discard}>Discard saved transaction</Button>
 <p className="mt-2 text-xs leading-relaxed text-ink-60">Checking is safer: it reuses the saved transaction instead of signing a new one. Discard only when the saved transaction cannot be included — a discarded transaction that is included later still moves your funds.</p></>}
 {receipt&&<div className="mt-5">{explorer(receipt)}</div>}
 </Card>
 <div className="mx-auto mt-6 flex max-w-xl justify-center"><StatusLine tone={nymReady?'good':'pending'} pulse={!nymReady}>Chain 1337 · {network}</StatusLine></div>
 <p className="mx-auto mt-3 max-w-xl text-center text-xs text-ink-60">PQ wallet authorization. Conventional zero-knowledge withdrawal proof; development setup.</p>
 {error&&<p role="alert" className="mx-auto mt-5 max-w-xl text-sm text-state-bad">{error}</p>}
 <Sheet open={walletOpen} onClose={()=>setWalletOpen(false)} title="PQ wallets"><div className="space-y-4 p-5"><p>{wallets.length} {wallets.length===1?'wallet':'wallets'} found</p>
 {wallets.map((w,i)=><div key={w.vault.publicKey} className="rounded-2xl bg-sunk p-4"><div className="flex items-center gap-3"><input aria-label={`Wallet ${i+1} name`} value={w.name} onChange={e=>save(wallets.map((a,j)=>j===i?{...a,name:e.target.value.slice(0,40)}:a))} className="min-w-0 flex-1 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-ink/15"/><div className="flex shrink-0 items-center gap-1">{active?.publicKey===w.vault.publicKey?<><span className="px-1 text-xs text-ink-60">Connected</span><button type="button" className={rowAction} disabled={busy} onClick={()=>download('qraft-wallet.json',JSON.stringify(w.vault))} aria-label="Download the encrypted wallet backup" title="Download the encrypted wallet backup"><DownloadIcon width={17} height={17}/></button><button type="button" className={rowAction} disabled={busy} onClick={lock} aria-label="Lock the PQ wallet" title="Lock the PQ wallet"><LockIcon width={17} height={17}/></button></>:<button type="button" className={rowAction} disabled={busy} onClick={()=>connect(w)} aria-label={`Unlock ${w.name}`} title={`Unlock ${w.name}`}><ChevronIcon width={17} height={17} className="-rotate-90"/></button>}</div></div><div className="mt-2 flex items-center gap-2 text-xs text-ink-60"><span className="truncate">{w.vault.address??'Deployment pending'}</span>{w.vault.address&&<button aria-label="Copy address" onClick={()=>copy(w.vault.address!)}><CopyIcon className="size-4"/></button>}</div></div>)}
 <Button className="w-full" busy={busy} onClick={create}>Create {wallets.length?'another ERC-8286 wallet':'ERC-8286 wallet'}</Button>
 <p className="text-xs text-ink-60">ERC-8286 modular account · ML-DSA-44 authorization</p>
 <label className="block cursor-pointer text-center text-sm underline">Import wallet backup<input className="sr-only" type="file" onChange={e=>{const f=e.target.files?.[0];if(f)void importWallet(f);}}/></label>
 {active&&<Row label="ETH balance">{walletBalance===null?'—':`${walletBalance} ETH`}</Row>}
 {busy&&<p className="text-sm text-ink-60">{status}</p>}
 </div></Sheet>
 <Sheet open={progress} onClose={()=>setProgress(false)} title={deployment?'':walletSetup?'Creating ERC-8286 wallet':tab==='deposit'?'Deposit transaction':'Withdrawal transaction'}><div className="space-y-5 p-5 pt-0">
 {deployment&&!busy?null:<div className="flex items-center gap-3" role="status">{busy&&<Spinner/>}<span>{status}</span></div>}
 {deployment?<><div className="flex flex-col items-center gap-3  text-center">
 <p className="text-3xl font-semibold tracking-[-0.03em]">ERC-8286 wallet deployed</p>
 </div>
 <ol className="divide-y divide-rule text-sm">
 <li className="flex items-center gap-3 py-3"><ToneIcon tone="good"/>ML-DSA-44 key sealed with your passkey</li>
 <li className="flex items-center gap-3 py-3"><ToneIcon tone="good"/>ERC-8286 account deployed on chain 1337</li>
 <li className="flex items-center gap-3 py-3"><ToneIcon tone="good"/>Deployment included through the alternative mempool</li>
 </ol>
 <RowGroup><Row label="Smart account">{active?.address?<span className="inline-flex items-center gap-2"><Mono>{truncateMiddle(active.address,10,8)}</Mono><button aria-label="Copy smart account address" title="Copy smart account address" onClick={()=>void copy(active.address!)} className="text-ink-60 transition-colors duration-[120ms] hover:text-ink"><CopyIcon className="size-4"/></button></span>:'—'}</Row>
 <Row label="Authorization">ML-DSA-44</Row></RowGroup>
 {explorer(deployment)}</>:walletSetup?<p className="text-xs text-ink-60">ERC-8286 modular account · ML-DSA-44 authorization</p>:<><ol className="divide-y divide-rule text-sm"><li className="py-3">1 · VERIFY · ML-DSA-44 wallet authorization</li><li className="py-3">2 · VERIFY · QRAFT paymaster approves gas</li><li className="py-3">3 · SENDER · Pool {tab==='deposit'?'deposit':'verifies proof and pays recipient'}</li></ol><p className="text-xs leading-relaxed text-ink-60">Submitted through Nym Anon-RPC to the alternative mempool. Nym hides your browser’s IP from the RPC provider; onchain addresses, amounts and transaction data remain public.</p>{receipt&&explorer(receipt)}</>}
 {error&&<p className="text-sm text-state-bad">{error}</p>}
 </div></Sheet>
 </main>;
}
