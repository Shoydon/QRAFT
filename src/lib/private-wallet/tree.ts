import {poseidon2} from 'poseidon-lite';
import {keccak256,stringToHex} from 'viem';
import {FIELD,TREE_DEPTH} from './model';

export class PrivateTree {
 readonly zeros:bigint[]=[];
 readonly layers:Map<number,bigint>[]=Array.from({length:TREE_DEPTH+1},()=>new Map());
 count=0;
 constructor(){let z=BigInt(keccak256(stringToHex('qraft.private.empty.v1')))%FIELD;this.zeros.push(z);for(let i=0;i<TREE_DEPTH;i++){z=poseidon2([z,z]);this.zeros.push(z);}}
 root(){return this.layers[TREE_DEPTH]!.get(0)??this.zeros[TREE_DEPTH]!;}
 insert(commitment:bigint){
  if(commitment<=0n||commitment>=FIELD||this.count>=2**TREE_DEPTH)throw Error('Invalid tree insertion');
  let index=this.count++;this.layers[0]!.set(index,commitment);
  for(let depth=0;depth<TREE_DEPTH;depth++){
   const left=index&~1,right=left+1;
   const node=poseidon2([this.layers[depth]!.get(left)??this.zeros[depth]!,this.layers[depth]!.get(right)??this.zeros[depth]!]);
   index=Math.floor(index/2);this.layers[depth+1]!.set(index,node);
  }
 }
 path(index:number){
  if(!Number.isSafeInteger(index)||index<0||index>=this.count)throw Error('Note is not in the tree');
  const pathElements:string[]=[],pathIndices:number[]=[];
  for(let depth=0;depth<TREE_DEPTH;depth++){pathElements.push(String(this.layers[depth]!.get(index^1)??this.zeros[depth]!));pathIndices.push(index%2);index=Math.floor(index/2);}
  return{pathElements,pathIndices};
 }
}
