import type {Hex} from 'viem';
import type {PoolDomain} from './model';
export interface PrivateDeployment{version:1;chainId:number;genesisHash:Hex;fromBlock:string;sidecarUrl:string;explorerUrl:string;contracts:Record<'pool'|'proofAccount'|'bootstrap'|'paymaster'|'validator'|'implementation'|'factory'|'proofVerifier'|'hasher',{address:Hex;runtimeHash:Hex}>}
export const deploymentDomain=(m:PrivateDeployment):PoolDomain=>({chainId:m.chainId,genesisHash:m.genesisHash,pool:m.contracts.pool.address});
export async function loadPrivateDeployment():Promise<PrivateDeployment>{const r=await fetch('/private-deployment.json',{cache:'no-store'});if(!r.ok)throw Error('Private wallet deployment is not installed');const m=await r.json() as PrivateDeployment;if(m.version!==1||m.chainId!==1337)throw Error('Unsupported private wallet deployment');return m;}
