// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Blake2b_512} from "./Blake2b_512.sol";
/// @notice Canonical public statement encoding; this component grants no spend permission.
library WithdrawalContext {
    struct Params {
        uint256 chainId; address pool; address asset; uint128 denomination;
        address recipient; address relayer; uint128 fee; uint64 deadline;
    }
    error InvalidDigestLength();
    function digest(Params memory c) internal view returns(bytes memory) {
        return Blake2b_512.hash(abi.encodePacked(
            "HIMITSU-WITHDRAW-CONTEXT-v2\x00",c.chainId,c.pool,c.asset,
            c.denomination,c.recipient,c.relayer,c.fee,c.deadline
        ));
    }
    /// Pool/verifier must derive c.chainId/pool/asset/denomination from its own state.
    function publicFieldsLE(bytes memory root,bytes memory nullifier,bytes memory context)
        internal pure returns(bytes memory result)
    {
        if(root.length!=64 || nullifier.length!=64 || context.length!=64) revert InvalidDigestLength();
        result=new bytes(96*8);
        bytes memory data=bytes.concat(root,nullifier,context);
        for(uint256 i;i<96;++i){result[8*i]=data[2*i];result[8*i+1]=data[2*i+1];}
    }
}
