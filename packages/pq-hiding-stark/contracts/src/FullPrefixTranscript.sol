// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512} from "./Blake2b_512.sol";
import {BlakeMerkle as M} from "./BlakeMerkle.sol";

/// @notice Exact v3 full-prefix public-salted byte transcript component.
/// @dev The final orchestrator MUST authenticate the complete State and exact prover
/// messages between calls. A caller-supplied memory state is not an authenticated session.
/// No checkpoint digest replaces records. Salts are fixed once at init, never at refill.
library FullPrefixTranscript {
    uint256 private constant P=18446744069414584321;
    uint256 internal constant MOVES=16;
    uint256 internal constant BLOCKS_PER_MOVE=64;
    uint256 internal constant MAX_HISTORY=1<<20;
    bytes internal constant DOMAIN="QRAFT-FS-FULL-PREFIX-v3\x00";
    bytes internal constant PROFILE="QRAFT-WITHDRAWAL-V3/q320-b16-e5\x00";
    struct State {
        bytes[16] records;
        M.Digest[16] salts;
        uint256 moves;
        uint256 nextBlock;
        uint256 remaining;
        uint256 accepted;
        uint256 historyBytes;
        bytes32 outputA;
        bytes32 outputB;
    }
    error Shape();
    error MoveIncomplete();
    error MoveComplete();
    error NeedsRefill();
    error BlockNotConsumed();
    error Bounds();
    function init(M.Digest[16] memory salts)internal pure returns(State memory state){state.salts=salts;}
    /// @notice Message contains only bytes observed since the previous sampling move.
    /// The first record automatically starts with the fixed PROFILE label.
    function beginMove(State memory state,bytes memory message)internal pure {
        if(state.moves>=MOVES)revert Bounds();
        if(state.moves!=0 && state.accepted!=5)revert MoveIncomplete();
        if(state.moves!=0 && message.length==0)revert Shape();
        bytes memory record=state.moves==0?abi.encodePacked(PROFILE,message):message;
        if(record.length>MAX_HISTORY-state.historyBytes)revert Bounds();
        state.records[state.moves]=record;state.historyBytes+=record.length;++state.moves;
        state.nextBlock=0;state.remaining=0;state.accepted=0;
    }
    function inputForBlock(State memory state)internal pure returns(bytes memory input){
        if(state.moves==0 || state.moves>MOVES || state.nextBlock>=BLOCKS_PER_MOVE)revert Bounds();
        uint256 size=DOMAIN.length+16+state.moves*8+state.moves*64;
        uint256 history;
        for(uint256 i;i<state.moves;++i){history+=state.records[i].length;}
        if(history!=state.historyBytes || history>MAX_HISTORY)revert Shape();
        input=new bytes(size+history);
        uint256 at=DOMAIN.length;copy(DOMAIN,input,0);
        put32(input,at,state.moves-1);at+=4;put32(input,at,state.nextBlock);at+=4;put32(input,at,state.moves);at+=4;
        for(uint256 i;i<state.moves;++i){
            uint256 n=state.records[i].length;put64(input,at,n);at+=8;copy(state.records[i],input,at);at+=n;
        }
        put32(input,at,state.moves);at+=4;
        for(uint256 i;i<state.moves;++i){
            M.Digest memory salt=state.salts[i];
            assembly("memory-safe"){mstore(add(add(input,32),at),mload(salt))mstore(add(add(input,64),at),mload(add(salt,32)))}
            at+=64;
        }
        assert(at==input.length);
    }
    /// @notice Exactly one next oracle block. Cannot change round salt or skip output.
    function refill(State memory state)internal view returns(M.Digest memory result){
        if(state.remaining!=0)revert BlockNotConsumed();
        if(state.moves==0 || state.moves>MOVES)revert Shape();
        if(state.accepted>=(state.moves==MOVES?320:5))revert MoveComplete();
        result=M.Digest(0,0);
        uint256 mark;assembly("memory-safe"){mark:=mload(0x40)}
        bytes memory raw=inputForBlock(state);bytes memory output=Blake2b_512.hash(raw);
        // Return struct was allocated before mark; only hash-input/output scratch is reclaimed.
        assembly("memory-safe"){mstore(result,mload(add(output,32)))mstore(add(result,32),mload(add(output,64)))}
        state.outputA=result.a;state.outputB=result.b;
        assembly("memory-safe"){mstore(0x40,mark)}
        ++state.nextBlock;state.remaining=64;
    }
    /// @notice One attempted canonical base coordinate, moves0..14 (five accepted each).
    /// A rejected word consumes bytes, keeps the same move/salt and does not advance accepted.
    function sampleCoordinate(State memory state)internal pure returns(bool accepted,uint256 value){
        if(state.moves==0 || state.moves>=MOVES)revert Shape();
        if(state.accepted>=5)revert MoveComplete();
        value=takeWord(state);accepted=value<P;if(accepted)++state.accepted;
    }
    /// @notice Move15 is ONE joint320-index vector. Each index uses exactly eight bytes.
    function sampleQuery(State memory state)internal pure returns(uint256 index){
        if(state.moves!=MOVES)revert Shape();
        if(state.accepted>=320)revert MoveComplete();
        index=takeWord(state)&65535;++state.accepted;
    }
    function finish(State memory state)internal pure {
        if(state.moves!=MOVES || state.accepted!=320 || state.nextBlock!=40 || state.remaining!=0)revert MoveIncomplete();
    }
    function takeWord(State memory state)private pure returns(uint256 value){
        if(state.remaining<8 || state.remaining>64 || state.remaining%8!=0)revert NeedsRefill();
        uint256 shift;bytes32 word;
        if(state.remaining>32){word=state.outputB;shift=(64-state.remaining)*8;}
        else{word=state.outputA;shift=(32-state.remaining)*8;}
        value=(uint256(word)>>shift)&type(uint64).max;state.remaining-=8;
    }
    function put32(bytes memory data,uint256 at,uint256 value)private pure {
        assembly("memory-safe"){mstore(add(add(data,32),at),shl(224,value))}
    }
    function put64(bytes memory data,uint256 at,uint256 value)private pure {
        assembly("memory-safe"){mstore(add(add(data,32),at),shl(192,value))}
    }
    function copy(bytes memory source,bytes memory target,uint256 offset)private pure {
        assembly("memory-safe"){
            let end:=add(add(source,32),mload(source))
            let dest:=add(add(target,32),offset)
            for{let pos:=add(source,32)}lt(pos,end){pos:=add(pos,32)dest:=add(dest,32)}{mstore(dest,mload(pos))}
        }
    }
}
