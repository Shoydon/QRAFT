// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512} from "./Blake2b_512.sol";

/// @notice V4 indexed binary hiding-MMCS verification. Each physical commitment has a distinct oracle domain.
/// @dev Index0 is canonical preprocessing; trace1, quotient2, randomizer3, FRI4..15.
/// Callers must derive the role index, never accept a prover-selected index as authority.
/// @dev Rows exclude salts. Both are canonical LE-u64 field elements, in native matrix order.
/// This verifies authentication only. The caller MUST derive roots, kind, height and indices
/// from its fixed verifier profile/transcript, and bind authenticated rows into FRI/AIR checks.
library IndexedBlakeMerkleV4 {
    uint256 private constant P = 18446744069414584321;
    enum Kind { Trace, AuthorizedTrace, Prep, Quotient, Random, Fri }
    struct Digest { bytes32 a; bytes32 b; }
    struct Opening {
        bytes[][] rows; // [query][matrix]
        bytes[][] salts; // [query][matrix], exactly sixteen base elements each
        Digest[] siblings; // pruned frontier: layer, ascending parent, missing child position
    }
    error Shape();
    error Index();
    error NonCanonical();
    error InconsistentDuplicate();
    error SiblingCount();
    error RootMismatch();

    function dimensions(Kind kind, uint256 logHeight) internal pure returns(uint256 matrices,uint256 width) {
        if(kind == Kind.Fri) {if(logHeight==0 || logHeight>15) revert Shape();}
        else if(logHeight!=16) revert Shape();
        matrices=kind==Kind.Quotient ? 16 : 1;
        if(kind==Kind.Trace) width=2703;
        else if(kind==Kind.AuthorizedTrace) width=2735;
        else if(kind==Kind.Prep) width=6;
        else width=10;
    }
    function verify(Digest memory root,Kind kind,uint256 logHeight,uint256[] memory indices,Opening memory proof,uint256 commitmentIndex) internal view {
        if(commitmentIndex>15)revert Index();
        (uint256 matrices,uint256 width)=dimensions(kind,logHeight);
        uint256 n=indices.length;
        if(n==0 || n>320 || proof.rows.length!=n || proof.salts.length!=n) revert Shape();
        uint256[] memory order=new uint256[](n);
        // Sort verifier-side indices, retaining original representatives for row lookup.
        for(uint256 q;q<n;++q){
            if(indices[q]>=uint256(1)<<logHeight) revert Index();
            if(proof.rows[q].length!=matrices || proof.salts[q].length!=matrices) revert Shape();
            for(uint256 m;m<matrices;++m){
                if(proof.rows[q][m].length!=width*8 || proof.salts[q][m].length!=128) revert Shape();
                canonical(proof.rows[q][m]);canonical(proof.salts[q][m]);
            }
            order[q]=q;
        }
        sortOrder(order,indices);
        uint256[] memory positions=new uint256[](n);
        Digest[] memory digests=new Digest[](n);
        uint256 count;
        for(uint256 i;i<n;++i){
            uint256 q=order[i];
            if(i>0 && indices[q]==indices[order[i-1]]){
                uint256 rep=order[i-1];
                for(uint256 m;m<matrices;++m){
                    if(!equal(proof.rows[q][m],proof.rows[rep][m]) || !equal(proof.salts[q][m],proof.salts[rep][m])) revert InconsistentDuplicate();
                }
            }else{
                positions[count]=indices[q];
                digests[count]=leaf(proof.rows[q],proof.salts[q],commitmentIndex);
                ++count;
            }
        }
        uint256 cursor;
        // In-place frontier updates write only earlier/equal slots; unread children remain intact.
        for(uint256 level;level<logHeight;++level){
            uint256 nextCount;uint256 i;
            while(i<count){
                uint256 position=positions[i];
                Digest memory left;Digest memory right;
                if(position&1==0){
                    left=digests[i];
                    if(i+1<count && positions[i+1]==position+1){right=digests[i+1];i+=2;}
                    else{if(cursor>=proof.siblings.length)revert SiblingCount();right=proof.siblings[cursor++];++i;}
                }else{
                    if(cursor>=proof.siblings.length)revert SiblingCount();
                    left=proof.siblings[cursor++];right=digests[i];++i;
                }
                positions[nextCount]=position>>1;
                digests[nextCount]=node(left,right,commitmentIndex);++nextCount;
            }
            count=nextCount;
        }
        if(cursor!=proof.siblings.length)revert SiblingCount();
        if(count!=1 || positions[0]!=0 || digests[0].a!=root.a || digests[0].b!=root.b)revert RootMismatch();
    }
    // Heapsort bounds work to O(n log n), even for an adversarial input ordering.
    function sortOrder(uint256[] memory order,uint256[] memory indices) private pure {
        uint256 n=order.length;
        for(uint256 start=n/2;start>0;){--start;sift(order,indices,start,n);}
        for(uint256 end=n;end>1;){
            --end;(order[0],order[end])=(order[end],order[0]);sift(order,indices,0,end);
        }
    }
    function sift(uint256[] memory order,uint256[] memory indices,uint256 root,uint256 end) private pure {
        while(root*2+1<end){
            uint256 child=root*2+1;
            if(child+1<end && indices[order[child]]<indices[order[child+1]])++child;
            if(indices[order[root]]>=indices[order[child]])return;
            (order[root],order[child])=(order[child],order[root]);root=child;
        }
    }
    /// @dev Enforces canonical Goldilocks LE-u64 encodings without silently reducing them.
    function canonical(bytes memory data) internal pure {
        if(data.length%8!=0)revert Shape();
        bool bad;
        assembly("memory-safe") {
            function reverse(v)->r {
                v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
                v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
                r:=or(shl(32,and(v,0xffffffff)),shr(32,v))
            }
            let end:=add(add(data,32),mload(data))
            for {let pos:=add(data,32)} lt(pos,end) {pos:=add(pos,8)} {
                if iszero(lt(reverse(shr(192,mload(pos))),18446744069414584321)) {bad:=1 break}
            }
        }
        if(bad)revert NonCanonical();
    }
    function equal(bytes memory a,bytes memory b) private pure returns(bool same){
        if(a.length!=b.length)return false;
        same=true;
        assembly("memory-safe"){
            let n:=mload(a)
            let i:=0
            for {} iszero(gt(add(i,32),n)) {i:=add(i,32)} {
                if iszero(eq(mload(add(add(a,32),i)),mload(add(add(b,32),i)))) {same:=0 break}
            }
            if and(same,lt(i,n)){
                let shift:=mul(sub(32,sub(n,i)),8)
                same:=eq(shr(shift,mload(add(add(a,32),i))),shr(shift,mload(add(add(b,32),i))))
            }
        }
    }
    /// @dev Low-level hash helper: verify() checks canonical encodings and fixed dimensions first.
    /// Calling leaf() alone neither validates an opening nor authenticates it to a root.
    function leaf(bytes[] memory rows,bytes[] memory salts,uint256 commitmentIndex) internal view returns(Digest memory r){
        if(rows.length!=salts.length)revert Shape();
        if(commitmentIndex>15)revert Index();
        uint256 len=31; // HIMITSU-P3-BLAKE2B-LEAF-v4\0
        for(uint256 i;i<rows.length;++i)len+=rows[i].length+salts[i].length;
        r=Digest(0,0);
        uint256 mark;assembly("memory-safe"){mark:=mload(0x40)}
        bytes memory input=new bytes(len);
        bytes memory tag=bytes("HIMITSU-P3-BLAKE2B-LEAF-v4\x00");
        uint256 at=tag.length;
        copy(tag,input,0);
        assembly("memory-safe"){mstore(add(add(input,32),at),shl(224,commitmentIndex))}
        at+=4;
        for(uint256 i;i<rows.length;++i){copy(rows[i],input,at);at+=rows[i].length;copy(salts[i],input,at);at+=salts[i].length;}
        bytes memory out=Blake2b_512.hash(input);
        assembly("memory-safe"){mstore(r,mload(add(out,32)))mstore(add(r,32),mload(add(out,64)))mstore(0x40,mark)}
    }
    function node(Digest memory left,Digest memory right,uint256 commitmentIndex) internal view returns(Digest memory r){
        r=Digest(0,0);
        uint256 mark;assembly("memory-safe"){mark:=mload(0x40)}
        bytes memory input=abi.encodePacked("HIMITSU-P3-BLAKE2B-NODE-v4\x00",uint32(commitmentIndex),left.a,left.b,right.a,right.b);
        bytes memory out=Blake2b_512.hash(input);
        assembly("memory-safe"){mstore(r,mload(add(out,32)))mstore(add(r,32),mload(add(out,64)))mstore(0x40,mark)}
    }
    function copy(bytes memory source,bytes memory target,uint256 offset) private pure {
        // Each write is within the target's rounded allocation; final overlap is overwritten
        // by the next copy. Only source.length bytes are ultimately hashed.
        assembly("memory-safe") {
            let end:=add(add(source,32),mload(source))
            let dest:=add(add(target,32),offset)
            for {let pos:=add(source,32)} lt(pos,end) {pos:=add(pos,32) dest:=add(dest,32)} {
                mstore(dest,mload(pos))
            }
        }
    }
}
