/** Activate already deployed staking-aware infrastructure after checking onchain code.
 * Public setup operations use sidecar-only gasCall and preserve their journals on failure. */
import {readFile,writeFile} from 'node:fs/promises';
import {encodeDeployData,encodeFunctionData,parseAbi,keccak256,type Hex} from 'viem';
import {gasCall} from '../src/lib/pq/service';
import manifest from '../public/pq-deployment.json';
if(manifest.chainId!==1337)throw Error('Requires chain 1337 bootstrap manifest');
const artifact=async(name:string)=>JSON.parse(await readFile(`packages/frame-account/artifacts/${name}.json`,'utf8'));
const implementation=await gasCall('alt-staking-implementation-v1',encodeDeployData({...await artifact('QraftFrameAccount'),args:[manifest.contracts.validator.address]}));
const key=JSON.parse(await readFile(process.env.QRAFT_DEPLOYER_KEY_FILE??'.local/alt-mempool-deployment/operator.json','utf8'));
const paymaster=await gasCall('alt-staking-paymaster-v1',encodeDeployData({...await artifact('QraftPaymaster'),args:[key.address,implementation,manifest.contracts.validator.address,manifest.pool,manifest.contracts.session.address,manifest.contracts.blobs.address]}));
if(!implementation||!paymaster)throw Error('Deployment address unavailable');
await gasCall('alt-staking-paymaster-funding-v1','0x',paymaster,100000000000000000n);
await gasCall('alt-staking-paymaster-stake-v1',encodeFunctionData({abi:parseAbi(['function stake(address registry,uint32 delay) payable']),functionName:'stake',args:['0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F',86400]}),paymaster,12000000000000000n);
async function runtimeHash(address:Hex){
 const response=await fetch(manifest.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[address,'latest']}),signal:AbortSignal.timeout(60000)});
 const body=await response.json();if(body.error||!body.result||body.result==='0x')throw Error('Deployed code unavailable');return keccak256(body.result);
}
const next=JSON.parse(await readFile('public/pq-deployment.json','utf8'));
next.contracts.implementation={address:implementation,runtimeHash:await runtimeHash(implementation)};
next.contracts.paymaster={address:paymaster,runtimeHash:await runtimeHash(paymaster)};
await writeFile('public/pq-deployment.json',JSON.stringify(next,null,2)+'\n');
console.log('Staking-aware infrastructure activated; run the live PQ test separately.');
