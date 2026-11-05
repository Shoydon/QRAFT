// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Goldilocks5 as G} from "./Goldilocks5.sol";
import {IndexedBlakeMerkleV4 as M} from "./IndexedBlakeMerkleV4.sol";

/// @notice Exact binary folding/authentication component for the pinned q320/b16 profile.
/// @dev No transcript/DEEP verification. The orchestrator MUST authenticate beta, roots,
/// original query indices, carried DEEP evaluations and complete round/query accounting.
library FriFoldV4 {
    uint256 private constant P=18446744069414584321;
    uint256 private constant INV_TWO=9223372034707292161;
    // P3 Goldilocks TWO_ADIC_GENERATORS[16], not a freely selected root of unity.
    uint256 private constant GENERATOR_16=0x54df9630bf79450e;
    error Shape();
    error Index();
    error FinalMismatch();

    /// @notice Pinned native two_adic_generator(logBits), for1..16.
    function generator(uint256 logBits) internal pure returns(uint256) {
        if(logBits==0 || logBits>16)revert Shape();
        return G.powBase(GENERATOR_16,uint256(1)<<(16-logBits));
    }
    function reverseBits(uint256 index,uint256 bits) internal pure returns(uint256 reversed) {
        if(bits>16 || index>=uint256(1)<<bits)revert Index();
        for(uint256 i;i<bits;++i){reversed=(reversed<<1)|(index&1);index>>=1;}
    }
    /// @notice Native fold_row(groupIndex,logHeight,log_arity=1,beta,[lo,hi]).
    /// logHeight is the AFTER-fold height; the profile uses15 down to4.
    function foldRow(uint256 groupIndex,uint256 logHeight,uint256[5] memory beta,uint256[5] memory lo,uint256[5] memory hi) internal pure returns(uint256[5] memory) {
        if(logHeight<4 || logHeight>15)revert Shape();
        uint256 reversed=reverseBits(groupIndex,logHeight);
        uint256 order=uint256(1)<<(logHeight+1);
        // s=g^bitreverse(groupIndex); g^order=1. No coset7 factor in native FRI folding.
        uint256 invS=G.powBase(generator(logHeight+1),order-reversed);
        return G.add(G.scale(G.add(lo,hi),INV_TWO),G.scale(G.mul(G.sub(lo,hi),beta),mulmod(invS,INV_TWO,P)));
    }
    /// @notice Reconstructs and authenticates each two-element extension row, then folds it.
    /// Native opening_proof carries salts and pruned authentication nodes, not row values.
    /// A call may cover1..320 queries; state orchestration must account for the required set.
    function foldRound(
        uint256 round,uint256[5] memory beta,uint256[] memory indices,
        uint256[5][] memory carried,uint256[5][] memory siblingValues,
        M.Digest memory root,bytes[][] memory salts,M.Digest[] memory authNodes
    ) internal view returns(uint256[] memory nextIndices,uint256[5][] memory folded) {
        bytes[][] memory openingRows;
        (nextIndices,folded,openingRows) = prepare(round,beta,indices,carried,siblingValues);
        M.Opening memory opening=M.Opening(openingRows,salts,authNodes);
        M.verify(root,M.Kind.Fri,15-round,nextIndices,opening,4+round);
    }
    function prepare(uint256 round,uint256[5] memory beta,uint256[] memory indices,uint256[5][] memory carried,uint256[5][] memory siblingValues) private pure returns(uint256[] memory nextIndices,uint256[5][] memory folded,bytes[][] memory openingRows) {
        if(round>=12)revert Shape();
        uint256 n=indices.length;
        if(n==0 || n>320 || carried.length!=n || siblingValues.length!=n)revert Shape();
        G.check(beta);
        uint256 logHeight=15-round;
        nextIndices=new uint256[](n);folded=new uint256[5][](n);
        openingRows=new bytes[][](n);
        for(uint256 q;q<n;++q){
            if(indices[q]>=uint256(1)<<(logHeight+1))revert Index();
            uint256[5] memory lo;uint256[5] memory hi;
            if(indices[q]&1==0){lo=carried[q];hi=siblingValues[q];}
            else{lo=siblingValues[q];hi=carried[q];}
            nextIndices[q]=indices[q]>>1;
            folded[q]=foldRow(nextIndices[q],logHeight,beta,lo,hi);
            openingRows[q]=new bytes[](1);
            openingRows[q][0]=serializeRow(lo,hi);
        }
    }
    /// @dev Native ExtensionMmcs flattens the first extension element's five coefficients,
    /// then the second, each canonical LE-u64. Salt attachment is performed by M.verify.
    function serializeRow(uint256[5] memory lo,uint256[5] memory hi) internal pure returns(bytes memory out) {
        G.check(lo);G.check(hi);out=new bytes(80);
        assembly("memory-safe") {
            function reverse(v)->r {
                v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
                v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
                r:=or(shl(32,and(v,0xffffffff)),shr(32,v))
            }
            for {let i:=0} lt(i,5) {i:=add(i,1)} {
                // mstore8 avoids writing outside the80-byte allocation's final word.
                let a:=reverse(mload(add(lo,mul(i,32))))
                let b:=reverse(mload(add(hi,mul(i,32))))
                for {let j:=0} lt(j,8) {j:=add(j,1)} {
                    mstore8(add(add(out,32),add(mul(i,8),j)),and(shr(mul(sub(7,j),8),a),255))
                    mstore8(add(add(out,72),add(mul(i,8),j)),and(shr(mul(sub(7,j),8),b),255))
                }
            }
        }
    }
    function checkFinal(uint256 roundsDone,uint256[5][] memory values,uint256[5] memory finalConstant) internal pure {
        if(roundsDone!=12 || values.length==0 || values.length>320)revert Shape();
        G.check(finalConstant);
        for(uint256 q;q<values.length;++q){
            G.check(values[q]);
            for(uint256 i;i<5;++i)if(values[q][i]!=finalConstant[i])revert FinalMismatch();
        }
    }
}
