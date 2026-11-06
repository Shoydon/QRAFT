/** Verify and fund the pinned chain-1337 deployment. Never redeploy or silently replace pins. */
import {createPublicClient,http,encodeFunctionData,parseAbi,keccak256,type Hex} from 'viem';
import {gasCall} from '../src/lib/pq/service';
import manifest from '../public/pq-deployment.json';
if(manifest.chainId!==1337)throw Error('Requires chain 1337 deployment manifest');
const client=createPublicClient({transport:http(manifest.rpcUrl,{timeout:60000,retryCount:2})});
if(await client.getChainId()!==1337||(await client.getBlock({blockNumber:0n})).hash!==manifest.genesisHash)throw Error('Wrong devnet identity');
for(const pin of Object.values(manifest.contracts)){
 const code=await client.getCode({address:pin.address as Hex});
 if(!code||keccak256(code)!==pin.runtimeHash)throw Error(`Deployment pin mismatch: ${pin.address}`);
}
const paymaster=manifest.contracts.paymaster.address as Hex;
const bindingAbi=parseAbi(['function implementation() view returns(address)','function validator() view returns(address)','function pool() view returns(address)']);
for(const [name,address] of [['implementation',manifest.contracts.implementation.address],['validator',manifest.contracts.validator.address],['pool',manifest.pool]] as const){
 const actual=await client.readContract({address:paymaster,abi:bindingAbi,functionName:name});
 if(actual.toLowerCase()!==address.toLowerCase())throw Error(`Sponsor ${name} binding differs`);
}
await gasCall(`${paymaster}:fund`,'0x',paymaster,100000000000000000n);
await gasCall(`${paymaster}:stake`,encodeFunctionData({abi:parseAbi(['function stake(address registry,uint32 delay) payable']),functionName:'stake',args:['0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F',86400]}),paymaster,12000000000000000n);
console.log('Verified infrastructure, paymaster funding and stake. Run the full lifecycle test separately.');
