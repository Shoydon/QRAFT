'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {formatEther,parseEther,isAddress,type Hex} from 'viem';
import {Button,Card,Row,RowGroup,StatusLine} from './primitives';
import {Sheet} from './Sheet';
import {LockIcon,Spinner} from './icons';
import {truncateMiddle} from '@/lib/format';
import {browserPageTransport} from '@/lib/transport/page-transport';
import {registerWalletPasskey} from '@/lib/pq/vault';
import {derivePrivateKeys,exportRecovery,importRecovery,decodePrivateAddress} from '@/lib/private-wallet/crypto';
import {deploymentDomain,loadPrivateDeployment,type PrivateDeployment} from '@/lib/private-wallet/deployment';
import {PrivateWalletEngine,type PaymentKind} from '@/lib/private-wallet/engine';
import {sealPrivateWallet,unlockPrivateWallet,erasePrivateKeys,type PrivateVault} from '@/lib/private-wallet/vault';
const STORAGE='qraft:private:wallets:v1';
interface Saved {name:string;vault:PrivateVault;backedUp:boolean;recoveryPending?:boolean}
type Panel=PaymentKind|'receive'|'wallets'|'backup'|'restore'|'details'|null;
function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const input='mt-2 w-full rounded-xl border border-rule bg-paper px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ink/20';
const eth=(value:bigint|null|undefined)=>value===null||value===undefined?'—':formatEther(value);
const exactAmount=(value:string)=>{if(!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))throw Error('Enter ETH with at most 18 decimal places');return parseEther(value);};
export function PrivateWalletApp(){
 const [manifest,setManifest]=useState<PrivateDeployment|null>(null),[wallets,setWallets]=useState<Saved[]>([]),[engine,setEngine]=useState<PrivateWalletEngine|null>(null);
 const [panel,setPanel]=useState<Panel>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[network,setNetwork]=useState('Connecting through Nym');
 const [amount,setAmount]=useState(''),[recipient,setRecipient]=useState(''),[review,setReview]=useState(false),[password,setPassword]=useState(''),[backupText,setBackupText]=useState(''),[downloaded,setDownloaded]=useState(false),[receipt,setReceipt]=useState<Hex|null>(null),[copied,setCopied]=useState(false);
 const [,redraw]=useState(0);
 const nymReady=network==='Nym connected';
 const selected=wallets.find(w=>w.vault.owner===String(engine?.keys.owner));
 useEffect(()=>{
  const transport=browserPageTransport();transport?.start();const off=transport?.subscribe(s=>setNetwork(s.phase==='ready'?'Nym connected':s.detail??'Connecting through Nym'));
  void loadPrivateDeployment().then(setManifest).catch(e=>setError(e.message));
  queueMicrotask(()=>{try{const list=JSON.parse(localStorage.getItem(STORAGE)??'[]');if(!Array.isArray(list)||list.some(w=>w.vault?.kind!=='qraft-private-vault'))throw Error();setWallets(list);}catch{setError('Saved wallet data could not be read. Restore your recovery file.');}});
  return()=>off?.();
 },[]);
 const save=(next:Saved[])=>{localStorage.setItem(STORAGE,JSON.stringify(next));setWallets(next);};
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'This action could not be completed');}finally{setBusy(false);redraw(n=>n+1);}};
 useEffect(()=>{
  if(!engine||!nymReady)return;
  let current=true;
  // Sync must not block local backup or receiving-address actions. Spending
  // still requires a snapshot and refreshes again inside the engine lock.
  queueMicrotask(()=>{if(current)void engine.refresh().catch(e=>{if(current)setError(e instanceof Error?e.message:'Balance sync failed');}).finally(()=>{if(current)redraw(n=>n+1);});});
  return()=>{current=false;};
 // A new unlocked wallet or recovered network starts one sync, not a retry loop.
 },[engine,nymReady]);
 useEffect(()=>{
  if(!engine||!nymReady||busy)return;
  let syncing=false,current=true;
  const sync=async()=>{if(syncing||document.hidden)return;syncing=true;try{await engine.refresh();if(current)redraw(n=>n+1);}catch(e){if(current)setError(e instanceof Error?e.message:'Balance sync failed');}finally{syncing=false;}};
  const timer=setInterval(()=>void sync(),30000);
  const visible=()=>{if(!document.hidden)void sync();};document.addEventListener('visibilitychange',visible);
  return()=>{current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[engine,nymReady,busy]);
 const rpc=()=>{const transport=browserPageTransport();if(!transport)throw Error('Browser transport unavailable');return{...transport,reconnect:()=>{transport.stop();transport.start();}};};
 const create=()=>run(async()=>{
  if(!manifest)throw Error('Wait for the private pool configuration');
  setStatus('Creating your wallet on this device');const keys=derivePrivateKeys(),session=await registerWalletPasskey();
  const vault=await sealPrivateWallet(keys,deploymentDomain(manifest),session);save([...wallets,{name:`Wallet ${wallets.length+1}`,vault,backedUp:false}]);
  engine?.lock();setReceipt(null);setEngine(new PrivateWalletEngine(manifest,keys,session,rpc(),setStatus));setPanel('backup');setPassword('');setDownloaded(false);setStatus('Wallet created. Save your recovery file before adding funds.');
 });
 const unlock=(saved:Saved)=>run(async()=>{
  if(!manifest)throw Error('Wait for the pool configuration');
  const {keys,session}=await unlockPrivateWallet(saved.vault,deploymentDomain(manifest));const next=new PrivateWalletEngine(manifest,keys,session,rpc(),setStatus);
  if(saved.recoveryPending){if(!nymReady)throw Error('Connect to the network to finish recovery');next.resetRecoveredJournal();await next.quarantine();save(wallets.map(w=>w.vault.owner===saved.vault.owner?{...w,recoveryPending:false}:w));}await next.load();
  engine?.lock();setReceipt(null);setEngine(next);setPanel(saved.backedUp?null:'backup');setPassword('');setDownloaded(false);
 });
 const restore=()=>run(async()=>{
  if(!manifest||!nymReady)throw Error('Connect to the network before restoring');
  const keys=await importRecovery(backupText,password,deploymentDomain(manifest));const existing=wallets.find(w=>w.vault.owner===String(keys.owner));
  const session=await registerWalletPasskey(),vault=await sealPrivateWallet(keys,deploymentDomain(manifest),session);
  const saved={name:existing?.name??`Wallet ${wallets.length+1}`,vault,backedUp:true,recoveryPending:true},others=wallets.filter(w=>w.vault.owner!==vault.owner);save([...others,saved]);
  const next=new PrivateWalletEngine(manifest,keys,session,rpc(),setStatus);next.resetRecoveredJournal();await next.quarantine();save([...others,{...saved,recoveryPending:false}]);engine?.lock();setReceipt(null);setEngine(next);setPanel(null);setPassword('');setBackupText('');setStatus('Restored. Checking for recent outgoing payments for five minutes.');
 });
 const open=(next:Panel)=>{setPanel(next);setReview(false);setAmount('');setRecipient('');setError('');setCopied(false);if(next==='backup'){setPassword('');setDownloaded(false);}};
 const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setCopied(true);}catch{setError('Copy was blocked by your browser. Select and copy the address.');}};
 const prepare=()=>{setError('');try{if(!engine)throw Error('Unlock your wallet');if(panel!=='combine'){const value=exactAmount(amount);if(value<=0n)throw Error('Enter an amount greater than zero');setAmount(formatEther(value));}if(panel==='send')decodePrivateAddress(recipient.trim(),engine.domain);if(panel==='withdraw'&&(!isAddress(recipient.trim())||/^0x0{40}$/i.test(recipient.trim())||recipient.trim().toLowerCase()===engine.domain.pool.toLowerCase()))throw Error('Enter a valid public Ethereum address');setReview(true);}catch(e){setError(e instanceof Error?e.message:'Check the payment details');}};
 const pay=()=>run(async()=>{if(!engine||!panel)throw Error('Unlock your wallet');setReceipt(null);const hash=await engine.pay(panel as PaymentKind,panel==='combine'?0n:exactAmount(amount),recipient.trim());setReceipt(hash??null);setPanel(null);});
 const title=panel==='shield'?'Add to private balance':panel==='send'?'Send privately':panel==='withdraw'?'Withdraw ETH':panel==='combine'?'Combine your balance':panel==='receive'?'Receive privately':panel==='wallets'?'Your wallets':panel==='backup'?'Your recovery file':panel==='restore'?'Restore your wallet':'How your wallet works';
 const payment=panel==='shield'||panel==='send'||panel==='withdraw'||panel==='combine';
 const quarantine=!!engine?.snapshot&&engine.snapshot.timestamp<=engine.quarantineUntil;
 return <main className="min-h-screen bg-paper px-5 py-6 text-ink sm:px-10">
  <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-rule pb-6"><Link href="/" className="text-lg font-semibold tracking-[0.18em]">QRAFT<span className="ml-3 align-middle text-[10px] font-normal tracking-widest text-ink-60">PRIVATE WALLET</span></Link><Button onClick={()=>open('wallets')}>{engine?selected?.name??'Your wallet':'Wallets'}{engine&&<span className="ml-2 inline-block size-1.5 rounded-full bg-state-good"/>}</Button></header>
  <div className="mx-auto grid max-w-6xl gap-10 py-14 lg:grid-cols-[1fr_280px] lg:gap-20 lg:py-20">
   <section>
    <div className="mb-8 flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-ink-60"><span className="size-1.5 rounded-full bg-ink"/>Your money. Your business.<span className="ml-auto rounded-full border border-rule px-2 py-1 text-[9px]">Devnet</span></div>
    {!engine?<><h1 className="max-w-xl text-5xl leading-[1.04] font-medium tracking-[-0.055em] sm:text-7xl">A private balance.<br/><span className="text-ink-60">Ready for real life.</span></h1><p className="mt-7 max-w-md text-base leading-relaxed text-ink-60">Add ETH, send an exact amount, and receive while you’re away. Your wallet takes care of the rest.</p><div className="mt-9 flex flex-wrap gap-3"><Button variant="primary" size="lg" busy={busy} disabled={!manifest} onClick={wallets.length?()=>open('wallets'):create}>{wallets.length?'Unlock your wallet':'Create private wallet'}</Button><Button variant="ghost" size="lg" disabled={busy} onClick={()=>open('restore')}>Restore wallet ↗</Button></div><p className="mt-5 text-xs text-ink-60">Keys stay on your device. Gas is sponsored on the devnet.</p></>:
    <><div className="flex items-center justify-between"><h1 className="text-sm text-ink-60">Available privately</h1><Button size="sm" variant="ghost" busy={busy} disabled={!nymReady} onClick={()=>run(()=>engine.refresh())}>Refresh ↻</Button></div>
     <div className="mt-4 flex flex-wrap items-baseline gap-3"><span className="break-all text-5xl leading-tight font-medium tracking-[-0.06em] sm:text-7xl" style={{fontVariantNumeric:'tabular-nums'}}>{eth(engine.available)}</span><span className="text-xl text-ink-60">ETH</span></div>
     <p className="mt-3 min-h-6 text-sm text-ink-60">{!engine.snapshot?'Your balance appears after a verified sync.':engine.snapshot.pendingBalance?`${eth(engine.snapshot.pendingBalance)} ETH incoming · confirming`:engine.intent?'A pending payment is reserved from this balance.':'One balance. Ready to send.'}</p>
     <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">{([['shield','↓','Add ETH'],['send','↗','Send'],['receive','↙','Receive'],['withdraw','↑','Withdraw']] as const).map(([kind,icon,label])=><button key={kind} aria-label={label} disabled={busy||(kind!=='receive'&&(!selected?.backedUp||!nymReady||!engine.snapshot||!!engine.intent||quarantine))} onClick={()=>open(kind)} className="group rounded-2xl border border-rule bg-surface p-5 text-left transition-colors hover:border-ink/30 hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-40"><span className="mb-6 block text-2xl">{icon}</span><span className="text-sm font-medium">{label}</span></button>)}</div>
     {!selected?.backedUp&&<Card className="mt-6 p-5"><p className="font-medium">Make this wallet recoverable.</p><p className="mt-2 text-sm text-ink-60">Save one encrypted recovery file. It restores your keys and finds your payments automatically.</p><Button className="mt-4" onClick={()=>open('backup')}>Save recovery file</Button></Card>}
     {quarantine&&<p className="mt-5 rounded-xl bg-sunk p-4 text-sm">Your balance is restored. Sending unlocks after the five-minute recovery check. Refresh to check progress.</p>}
     {engine.intent&&<Card className="mt-6 p-5"><p className="font-medium">{engine.intent.description} · awaiting resolution</p><p className="mt-2 text-sm leading-relaxed text-ink-60">Keep this payment until its chain status is known. Checking reuses the same submission.</p><Button className="mt-4" busy={busy} disabled={!nymReady} onClick={()=>run(async()=>{const hash=await engine.reconcile();if(hash)setReceipt(hash);})}>Check payment</Button></Card>}
     <div className="mt-10 border-t border-rule pt-6"><div className="flex items-center justify-between"><span className="text-sm font-medium">Wallet activity</span><button disabled={busy} onClick={()=>open('combine')} className="text-xs text-ink-60 underline underline-offset-4">Combine balance</button></div>
      <div className="mt-5 flex items-start gap-3 text-sm" role="status" aria-live="polite">{busy?<Spinner/>:<span className="mt-1 size-1.5 shrink-0 rounded-full bg-ink-60"/>}<div><p>{status||'Unlock and sync to see your balance'}</p>{receipt&&manifest&&<a href={`${manifest.explorerUrl}/tx/${receipt}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline underline-offset-4">View confirmed transaction ↗</a>}</div></div>
     </div>
    </>}
    {error&&<p role="alert" className="mt-5 rounded-xl border border-state-bad/20 p-4 text-sm text-state-bad">{error}</p>}
   </section>
   <aside className="space-y-8 border-t border-rule pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"><div><p className="text-[10px] uppercase tracking-[0.16em] text-ink-60">Built around you</p><h2 className="mt-4 text-2xl font-medium leading-tight tracking-tight">Private payments.<br/>Ordinary simplicity.</h2></div><div className="space-y-6 text-sm">{[['01','One balance','Every incoming payment joins your balance automatically.'],['02','Exact amounts','Send what you mean. The remainder stays yours.'],['03','Receive offline','Share your receiving address once. Catch up when you return.']].map(([n,t,d])=><div key={n}><span className="mr-3 text-xs text-ink-60">{n}</span><span className="font-medium">{t}</span><p className="mt-2 pl-7 text-xs leading-relaxed text-ink-60">{d}</p></div>)}</div><button className="text-xs underline underline-offset-4" onClick={()=>open('details')}>Privacy & recovery details ↗</button>{engine&&<Button variant="ghost" disabled={busy} icon={<LockIcon width={14}/>} onClick={()=>{engine.lock();setEngine(null);setReceipt(null);setPassword('');setBackupText('');setStatus('Wallet locked');}}>Lock wallet</Button>}</aside>
  </div>
  <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-rule py-5 text-xs text-ink-60"><div className="flex flex-wrap items-center gap-3"><StatusLine tone={nymReady?'good':'pending'} pulse={!nymReady}>{network}</StatusLine>{(!nymReady||/network|RPC|timed out|timeout|fetch/i.test(error))&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{const transport=rpc();transport.stop();transport.start();}}>Reconnect network</Button>}</div><span>EF devnet · ETH · Development proof setup</span></footer>
  <Sheet open={panel!==null} onClose={()=>{if(!busy)setPanel(null);}} title={title}><div className="space-y-5 p-5">
   {payment&&engine&&(!review?<>
    {panel==='shield'&&<><p className="text-sm text-ink-60">Move ETH from your public wallet into your private balance. The deposit amount and public wallet are visible onchain.</p><RowGroup><Row label="Public ETH">{eth(engine.publicBalance)} ETH</Row></RowGroup><label className="block text-xs text-ink-60">Fund this public address<input readOnly className={input+' font-mono text-xs'} value={engine.address}/></label><Button size="sm" onClick={()=>copy(engine.address)}>{copied?'Copied':'Copy public address'}</Button></>}
    {panel==='combine'?<p className="text-sm leading-relaxed text-ink-60">Combine up to four smaller incoming payments into one spendable piece. Your total stays the same. Qraft sponsors the gas. Repeat if a large payment still needs preparation.</p>:<label className="block text-sm">Amount in ETH<input autoFocus inputMode="decimal" placeholder="0.00" value={amount} onChange={e=>setAmount(e.target.value)} className={input+' text-2xl'}/></label>}
    {(panel==='send'||panel==='withdraw')&&<label className="block text-sm">{panel==='send'?'Private receiving address':'Public Ethereum address'}<textarea rows={3} value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder={panel==='send'?'qraft1.…':'0x…'} className={input+' resize-none font-mono text-xs'}/></label>}
    <Button variant="primary" className="w-full" disabled={busy||!!engine.intent||quarantine||!selected?.backedUp||!nymReady} onClick={prepare}>Review {panel==='combine'?'combination':panel==='shield'?'deposit':'payment'}</Button>
   </>:<>
    <div className="py-4 text-center"><p className="text-sm text-ink-60">{panel==='combine'?'Prepare your balance':panel==='send'?'You send privately':panel==='shield'?'You add privately':'You withdraw publicly'}</p><p className="mt-3 text-4xl font-medium tracking-tight">{panel==='combine'?'Same balance':`${amount} ETH`}</p></div>
    {(panel==='send'||panel==='withdraw')&&<details className="rounded-xl bg-sunk p-3 text-xs"><summary className="cursor-pointer">Recipient · {truncateMiddle(recipient,16,10)}</summary><p className="mt-3 break-all font-mono">{recipient}</p></details>}
    <RowGroup><Row label="Gas">Sponsored by Qraft</Row><Row label="Proof">Created on your device</Row><Row label="Delivery">{panel==='shield'?'Nym → devnet':'Shared relay → devnet'}</Row></RowGroup>
    <p className="text-xs leading-relaxed text-ink-60">{panel==='withdraw'?'The recipient and withdrawn amount become public. ':''}{panel!=='shield'?'The HTTPS relay can see your IP and timing. It receives a proof, never your wallet keys or plaintext private amounts.':'Your public deposit address and amount remain visible.'}</p>
    <Button variant="primary" className="w-full" busy={busy} onClick={pay}>{panel==='combine'?'Combine balance':panel==='shield'?'Add ETH':panel==='withdraw'?'Withdraw ETH':'Send privately'}</Button><Button variant="ghost" className="w-full" disabled={busy} onClick={()=>setReview(false)}>Edit details</Button>
   </>)}
   {panel==='receive'&&engine&&<><p className="text-sm text-ink-60">Share this with another Qraft wallet. You can be offline when they send. Only this wallet can decrypt the payment.</p><textarea readOnly rows={5} aria-label="Private receiving address" className={input+' font-mono text-xs'} value={engine.receivingAddress}/><Button variant="primary" className="w-full" onClick={()=>copy(engine.receivingAddress)}>{copied?'Address copied':'Copy private address'}</Button><Button className="w-full" onClick={()=>download('qraft-receiving-address.json',JSON.stringify({address:engine.receivingAddress}))}>Download receiving address</Button><p className="text-xs text-ink-60">This is a private payment address, not a public 0x address. It contains public receiving data, never your secret keys.</p></>}
   {panel==='wallets'&&<>{wallets.map(w=><button key={w.vault.owner} disabled={busy} onClick={()=>unlock(w)} className="flex w-full items-center justify-between rounded-xl border border-rule p-4 text-left"><span><span className="block font-medium">{w.name}</span><span className="mt-1 block text-xs text-ink-60">{w.backedUp?'Recovery file saved':'Backup needed'} · Passkey protected</span></span><span>↗</span></button>)}<Button className="w-full" busy={busy} disabled={!manifest} onClick={create}>Create another wallet</Button><Button variant="ghost" className="w-full" disabled={busy} onClick={()=>open('restore')}>Restore from recovery file</Button>{engine&&<Button variant="ghost" className="w-full" disabled={busy} onClick={()=>open('backup')}>Export recovery file</Button>}</>}
   {panel==='backup'&&engine&&<><p className="text-sm leading-relaxed text-ink-60">One file restores your wallet on a new device, including all payments recorded in this pool. Keep it and its password somewhere safe.</p><label className="block text-sm">Recovery password<input type="password" autoComplete="new-password" value={password} onChange={e=>{setPassword(e.target.value);setDownloaded(false);}} placeholder="At least 12 characters" className={input}/></label><Button variant="primary" className="w-full" busy={busy} disabled={password.length<12} onClick={()=>run(async()=>{const recovery=await exportRecovery(engine.keys.master,engine.domain,password);const check=await importRecovery(recovery,password,engine.domain);try{if(check.owner!==engine.keys.owner)throw Error('Recovery verification failed');}finally{erasePrivateKeys(check);}download('qraft-private-recovery.json',recovery);setDownloaded(true);})}>Download encrypted recovery file</Button>{downloaded&&<Button className="w-full" onClick={()=>{save(wallets.map(w=>w.vault.owner===String(engine.keys.owner)?{...w,backedUp:true}:w));setPassword('');setPanel(null);}}>I saved the file and password</Button>}<p className="text-xs text-ink-60">Your passkey unlocks this device. The file and password restore a new one. Qraft cannot recover either for you.</p></>}
   {panel==='restore'&&<><p className="text-sm text-ink-60">Import your encrypted recovery file, then create a passkey for this device. Your private balance is found from pool history.</p><label className="block rounded-xl border border-dashed border-rule p-4 text-sm">Choose recovery file<input type="file" accept="application/json,.json" className="mt-3 block w-full text-xs" onChange={e=>{const f=e.target.files?.[0];if(f)void f.text().then(setBackupText);}}/></label><label className="block text-sm">Recovery password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className={input}/></label><Button variant="primary" className="w-full" busy={busy} disabled={!backupText||!password||!nymReady} onClick={restore}>Restore wallet</Button><p className="text-xs text-ink-60">Sending waits five minutes after restore so old pending proofs can expire. Avoid sending simultaneously from another device.</p></>}
   {panel==='details'&&<div className="space-y-4 text-sm leading-relaxed text-ink-60"><p>Qraft totals your unspent private payments locally. When you send, it selects them automatically and returns any change to you.</p><p>Your wallet uses separate signing, spending, and receiving keys, all derived from one backed-up secret. You do not manage a separate viewing key.</p><p>ML-DSA protects public-wallet authorization. ML-KEM protects payment delivery. The Groth16 proof system is conventional cryptography; this is not an end-to-end post-quantum payment system.</p><p>Public deposits and withdrawals reveal their amounts and public addresses. Private sends use a shared carrier. The HTTPS relay sees IP addresses and timing; pool activity can still permit correlation.</p><p>This is an experimental devnet wallet with a single-operator proof setup. Discovery scans the pool history. It does not implement STRK20’s scalable channels or STARK proving system.</p></div>}
   {busy&&<div role="status" className="flex items-center gap-2 text-sm"><Spinner/>{status}</div>}{error&&<p role="alert" className="text-sm text-state-bad">{error}</p>}
  </div></Sheet>
 </main>;
}
