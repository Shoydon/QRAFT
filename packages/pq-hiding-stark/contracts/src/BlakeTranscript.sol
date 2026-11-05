// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512} from "./Blake2b_512.sol";

/// @notice Exact byte HashChallenger + SerializingChallenger64 sampling primitive.
/// @dev Protocol framing must be built by the fixed verifier, never supplied as authority.
library BlakeTranscript {
    uint256 internal constant P = 18446744069414584321;
    struct State { bytes input; bytes output; uint256 remaining; }
    error InvalidBits();
    error NonCanonical();
    error InvalidEncoding();

    function init(bytes memory domain) internal pure returns(State memory s) {
        s.input=domain;s.output=new bytes(0);
    }
    function observe(State memory s,bytes memory data) internal pure {
        if(data.length==0) return;
        s.remaining=0;s.input=bytes.concat(s.input,data);
    }
    function observeField(State memory s,uint256 value) internal pure {
        if(value>=P) revert NonCanonical();
        bytes memory encoded=new bytes(8);
        for(uint256 i;i<8;++i) encoded[i]=bytes1(uint8(value>>(8*i)));
        observe(s,encoded);
    }
    function observeFieldsLE(State memory s,bytes memory data) internal pure {
        if(data.length%8!=0) revert InvalidEncoding();
        for(uint256 i;i<data.length;i+=8) {
            uint256 value;for(uint256 j;j<8;++j)value|=uint256(uint8(data[i+j]))<<(8*j);
            if(value>=P) revert NonCanonical();
        }
        observe(s,data);
    }
    function sampleByte(State memory s) internal view returns(uint8) {
        if(s.remaining==0) {
            s.output=Blake2b_512.hash(s.input);
            s.input=s.output;s.remaining=64;
        }
        return uint8(s.output[--s.remaining]);
    }
    function sampleU64(State memory s) internal view returns(uint256 value) {
        for(uint256 i;i<8;++i)value|=uint256(sampleByte(s))<<(8*i);
    }
    function sampleField(State memory s) internal view returns(uint256 value) {
        do { value=sampleU64(s); } while(value>=P);
    }
    function sampleExtension(State memory s) internal view returns(uint256[5] memory value) {
        for(uint256 i;i<5;++i)value[i]=sampleField(s);
    }
    function sampleBits(State memory s,uint256 bits) internal view returns(uint256) {
        if(bits>=64 || (uint256(1)<<bits)>=P) revert InvalidBits();
        return sampleU64(s)&((uint256(1)<<bits)-1);
    }
}
