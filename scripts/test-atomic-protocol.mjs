import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,keccak256,stringToHex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {poseidon2,poseidon1} from 'poseidon-lite';
import {groth16} from 'snarkjs';
import {NoteTree} from '../src/lib/protocol/tree.ts';
const node=spawn('anvil',['--silent','--port','18550','--chain-id','1337'],{stdio:'ignore'});
const account=mnemonicToAccount('test test test test test test test test test test test junk');
const client=createPublicClient({transport:http('http://127.0.0.1:18550')});
const wallet=createWalletClient({account,transport:http('http://127.0.0.1:18550')});
const h=n=>'0x'+n.toString(16).padStart(64,'0');
try {
 for(let i=0;i<50;i++){try{await client.getChainId();break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const deploy=async(name,args=[])=>{const artifact=JSON.parse(await readFile('packages/atomic/artifacts/'+name+'.json','utf8'));const hash=await wallet.deployContract({...artifact,args,chain:null});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return{address:r.contractAddress,abi:artifact.abi};};
 const verifier=await deploy('SpendVerifierStock');
 const amount=100000000000000n;
 const pool=await deploy('AtomicPool',[verifier.address,amount]);
 for(let i=0;i<20;i++)assert.equal(await client.readContract({...pool,functionName:'poseidon',args:[[h(BigInt(i)),h(BigInt(i+5))]]}),h(poseidon2([BigInt(i),BigInt(i+5)])));
 const tree=new NoteTree();const notes=[];
 for(let i=1;i<=2;i++){
 const nullifier=BigInt(keccak256(stringToHex('test nullifier '+i)))%(2n**240n),secret=BigInt(keccak256(stringToHex('test secret '+i)))%(2n**240n);
 const commitment=h(poseidon2([nullifier,secret])),nullifierHash=h(poseidon1([nullifier]));
 const r=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...pool,functionName:'deposit',args:[commitment],value:amount,chain:null})});assert.equal(r.status,'success');tree.insert(BigInt(commitment));notes.push({nullifier,secret,nullifierHash});
 }
 assert.equal(await client.readContract({...pool,functionName:'currentRoot'}),h(tree.root()));
 const root=h(tree.root()),expiry=BigInt((await client.getBlock()).timestamp)+3600n;
 const prove=async(note,recipient,index)=>{
 const digest=BigInt(await client.readContract({...pool,functionName:'withdrawalDigest',args:[root,note.nullifierHash,recipient,expiry]}));
 const input={root:String(tree.root()),nullifierHash:String(BigInt(note.nullifierHash)),recipient:String(BigInt(recipient)),txHashHi:String(digest>>128n),txHashLo:String(digest&((1n<<128n)-1n)),nullifier:String(note.nullifier),secret:String(note.secret),...tree.path(index)};
 const {proof,publicSignals}=await groth16.fullProve(input,'protocol/circuits/spend.wasm','protocol/circuits/spend.zkey',undefined,undefined,{singleThread:true});
 const vk=JSON.parse(await readFile('public/proving/verification_key.json','utf8'));assert.equal(await groth16.verify(vk,publicSignals,proof),true);
 return(await groth16.exportSolidityCallData(proof,publicSignals)).match(/0x[0-9a-fA-F]+/g).slice(0,8).map(BigInt);
 };
 const recipient='0x0000000000000000000000000000000000001234';const proof=await prove(notes[0],recipient,0);
 const args=[root,notes[0].nullifierHash,recipient,expiry,proof];
 for(const altered of [[root,notes[0].nullifierHash,account.address,expiry,proof],[root,notes[0].nullifierHash,recipient,expiry+1n,proof],[root,notes[0].nullifierHash,recipient,expiry,Array(8).fill(0n)],[h(1n),notes[0].nullifierHash,recipient,expiry,proof]])await assert.rejects(()=>client.simulateContract({...pool,account,functionName:'withdraw',args:altered}));
 const before=await client.getBalance({address:recipient});
 const receipt=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...pool,functionName:'withdraw',args,chain:null})});assert.equal(receipt.status,'success');assert.equal(await client.getBalance({address:recipient})-before,amount);
 await assert.rejects(()=>client.simulateContract({...pool,account,functionName:'withdraw',args}));
 const reject=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:[],bytecode:'0x6005600c60003960056000f360006000fd',chain:null})});
 const bad=await prove(notes[1],reject.contractAddress,1);
 const failed=await client.waitForTransactionReceipt({hash:await wallet.writeContract({...pool,functionName:'withdraw',args:[root,notes[1].nullifierHash,reject.contractAddress,expiry,bad],gas:1000000n,chain:null})});assert.equal(failed.status,'reverted');assert.equal(await client.readContract({...pool,functionName:'spent',args:[notes[1].nullifierHash]}),false);
 const result={passed:true,poseidonVectors:20,realProofs:2,withdrawGas:String(receipt.gasUsed),mutationsRejected:4,replayRejected:true,payoutRollback:true};await writeFile('docs/pq/atomic-protocol-test.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{node.kill('SIGTERM');await globalThis.curve_bn128?.terminate();}
