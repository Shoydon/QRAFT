import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,hexToBytes} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {groth16} from 'snarkjs';
import {poseidon5} from 'poseidon-lite';
import solc from 'solc';
const built=spawnSync('bun',['build','src/lib/private-wallet/protocol.ts','--target=node','--outfile=.local/private-pool-build/protocol.mjs'],{stdio:'inherit'});if(built.status!==0)throw Error('bundle failed');
const {PrivateTree,derivePrivateKeys,encodePrivateAddress,decodePrivateAddress,buildPrivateAction,privatePoolAbi,actionDigest,decryptNote}=await import('../.local/private-pool-build/protocol.mjs');
const node=spawn('anvil',['--silent','--port','18551','--chain-id','1337'],{stdio:'ignore'});
const account=mnemonicToAccount('test test test test test test test test test test test junk');
const client=createPublicClient({transport:http('http://127.0.0.1:18551')});
const wallet=createWalletClient({account,transport:http('http://127.0.0.1:18551')});
const vk=JSON.parse(await readFile('public/private-proving/verification_key.json','utf8'));
const measurements=[];
try{
 for(let i=0;i<50;i++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const genesis=(await client.getBlock({blockNumber:0n})).hash;
 async function deploy(name,args=[]){const a=JSON.parse(await readFile('packages/private-pool/build/'+name+'.json','utf8'));const receipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({...a,args,chain:null})});assert.equal(receipt.status,'success');return receipt.contractAddress;}
 const verifier=await deploy('JoinSplitVerifier'),hasher=await deploy('Poseidon'),pool=await deploy('PrivatePool',[verifier,hasher,genesis]);
 const domain={chainId:1337,genesisHash:genesis,pool},tree=new PrivateTree();
 const alice=derivePrivateKeys(new Uint8Array(32).fill(1)),bob=derivePrivateKeys(new Uint8Array(32).fill(2)),carol=derivePrivateKeys(new Uint8Array(32).fill(3));
 const receiver=keys=>decodePrivateAddress(encodePrivateAddress(domain,keys),domain);
 async function build(keys,kind,inputs,outputs,extra={}){return buildPrivateAction({domain,keys,tree,inputs,outputs:outputs.map(([keys,amount])=>({recipient:receiver(keys),amount})),kind,expiry:(await client.getBlock()).timestamp+240n,...extra});}
 async function prove(plan){const start=performance.now();const p=await groth16.fullProve(plan.witness,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true});assert.deepEqual(p.publicSignals,plan.signals);assert.equal(await groth16.verify(vk,p.publicSignals,p.proof),true);const words=(await groth16.exportSolidityCallData(p.proof,p.publicSignals)).match(/0x[0-9a-fA-F]+/g).slice(0,8).map(BigInt);measurements.push({kind:plan.action.kind,proveMs:Math.round(performance.now()-start)});return{words,...p};}
 async function settle(plan,words){assert.equal(await client.readContract({address:pool,abi:privatePoolAbi,functionName:'actionDigest',args:[plan.action]}),actionDigest(domain,plan.action));const receipt=await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:pool,abi:privatePoolAbi,functionName:'transact',args:[plan.action,words],value:plan.action.deposit,chain:null})});assert.equal(receipt.status,'success');const notes=plan.notes.map(n=>{const index=tree.count;tree.insert(n.commitment);return{...n,index};});assert.equal(await client.readContract({address:pool,abi:privatePoolAbi,functionName:'currentRoot'}),tree.root());measurements.at(-1).gas=receipt.gasUsed.toString();return notes;}
 const a1=await build(alice,0,[],[[alice,2000n]],{deposit:2000n});const p1=await prove(a1);const [n1]=await settle(a1,p1.words);
 const a2=await build(alice,0,[],[[alice,2000n]],{deposit:2000n});const p2=await prove(a2);const [n2]=await settle(a2,p2.words);
 const send=await build(alice,1,[n1,n2],[[bob,1500n],[alice,2500n]]);const ps=await prove(send);
 for(const at of [1,2,5,10,12,13]){const signals=[...ps.publicSignals];signals[at]=(BigInt(signals[at])+1n).toString();assert.equal(await groth16.verify(vk,signals,ps.proof),false);}
 const mutate=async action=>assert.rejects(()=>client.simulateContract({address:pool,abi:privatePoolAbi,account,functionName:'transact',args:[action,ps.words]}));
 await mutate({...send.action,expiry:send.action.expiry+1n});
 await mutate({...send.action,outputs:[send.action.outputs[0]+1n,send.action.outputs[1]]});
 await mutate({...send.action,envelopes:[send.action.envelopes[0].slice(0,-2)+(parseInt(send.action.envelopes[0].slice(-2),16)^1).toString(16).padStart(2,'0'),send.action.envelopes[1]]});
 await mutate({...send.action,nullifiers:[send.action.nullifiers[0],send.action.nullifiers[0],0n,0n]});
 await mutate({...send.action,recipient:'0x0000000000000000000000000000000000001234'});
 await mutate({...send.action,kind:2});
 for(const key of ['spendingSecret','root']){const bad={...send.witness,[key]:(BigInt(send.witness[key])+1n).toString()};await assert.rejects(()=>groth16.fullProve(bad,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true}));}
 const inflation={...send.witness,outputAmounts:[String(BigInt(send.witness.outputAmounts[0])+1n),send.witness.outputAmounts[1]]};await assert.rejects(()=>groth16.fullProve(inflation,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true}));
 for(const field of ['outputOwners','outputRhos']){const bad=structuredClone(send.witness);bad[field][0]='0';bad.commitments[0]=String(poseidon5([2n,BigInt(bad.domain),BigInt(bad.outputOwners[0]),BigInt(bad.outputAmounts[0]),BigInt(bad.outputRhos[0])]));await assert.rejects(()=>groth16.fullProve(bad,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true}));}
 const overflow={...send.witness,outputAmounts:[String(1n<<128n),send.witness.outputAmounts[1]]};await assert.rejects(()=>groth16.fullProve(overflow,'public/private-proving/join-split.wasm','public/private-proving/join-split.zkey',undefined,undefined,{singleThread:true}));
 const [bn,change]=await settle(send,ps.words);assert.equal(change.amount,2500n);
 await mutate(send.action);
 const recovered=await decryptNote(domain,bob,bn.commitment,hexToBytes(send.action.envelopes[0]));assert.equal(recovered.amount,1500n);
 const onward=await build(bob,1,[bn],[[carol,700n],[bob,800n]]);const po=await prove(onward);const [cn]=await settle(onward,po.words);
 const recipient='0x0000000000000000000000000000000000001234';
 const withdrawal=await build(carol,2,[cn],[[carol,200n]],{withdrawal:500n,recipient});const pw=await prove(withdrawal);const before=await client.getBalance({address:recipient});const [remaining]=await settle(withdrawal,pw.words);assert.equal(await client.getBalance({address:recipient})-before,500n);
 assert.equal(await client.getBalance({address:pool}),3500n);
 const rejecting=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Reject.sol':{content:'pragma solidity ^0.8.28; contract Reject { receive() external payable { revert(); } }'}},settings:{outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}))).contracts['Reject.sol'].Reject;
 const rr=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:rejecting.abi,bytecode:'0x'+rejecting.evm.bytecode.object,chain:null})});
 const badPayout=await build(carol,2,[remaining],[[carol,150n]],{withdrawal:50n,recipient:rr.contractAddress});const bp=await prove(badPayout),beforeRoot=tree.root();
 const reverted=await client.waitForTransactionReceipt({hash:await wallet.writeContract({address:pool,abi:privatePoolAbi,functionName:'transact',args:[badPayout.action,bp.words],gas:3000000n,chain:null})});assert.equal(reverted.status,'reverted');assert.equal(await client.readContract({address:pool,abi:privatePoolAbi,functionName:'currentRoot'}),beforeRoot);assert.equal(await client.readContract({address:pool,abi:privatePoolAbi,functionName:'spent',args:[badPayout.action.nullifiers[0]]}),false);assert.equal(await client.getBalance({address:pool}),3500n);
 const result={passed:true,flow:'Alice shields twice, joins two notes to pay Bob, Bob pays offline Carol, Carol decrypts and partially withdraws',measurements,publicSignalMutations:6,calldataMutations:6,invalidWitnessesRejected:6,payoutReversionAtomic:true,replayRejected:true,poolBalance:'3500'};
 await writeFile('docs/pq/private-pool-local.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{node.kill('SIGTERM');await globalThis.curve_bn128?.terminate();}
