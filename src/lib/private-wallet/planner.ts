import {INPUT_COUNT,MAX_AMOUNT,type IndexedNote} from './model';

export interface NoteSelection {inputs:IndexedNote[];change:bigint;consolidationRequired:boolean}
export function selectNotes(notes:readonly IndexedNote[],amount:bigint,reserved:ReadonlySet<string>):NoteSelection {
 if(amount<=0n||amount>MAX_AMOUNT)throw Error('Enter a positive supported amount');
 const candidates=notes.filter(n=>!reserved.has(n.commitment.toString())).sort((a,b)=>a.amount===b.amount?a.index-b.index:a.amount>b.amount?-1:1);
 if(candidates.reduce((sum,n)=>sum+n.amount,0n)<amount)throw Error('Insufficient private balance');
 const single=candidates.filter(n=>n.amount>=amount).at(-1);
 if(single)return{inputs:[single],change:single.amount-amount,consolidationRequired:false};
 const selected:IndexedNote[]=[];let total=0n;
 for(const note of candidates){selected.push(note);total+=note.amount;if(total>=amount)break;}
 return{inputs:selected,change:total-amount,consolidationRequired:selected.length>INPUT_COUNT};
}
