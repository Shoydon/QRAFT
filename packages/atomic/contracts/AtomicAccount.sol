// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
interface IAtomicSignatureVerifier {
    function verify(bytes calldata key,bytes calldata message,bytes calldata signature) external view returns(bool);
}
/// One wallet, one contract. Public verification data is supplied in signed calldata.
contract AtomicAccount {
    address public immutable verifier;
    bytes32 public immutable keyCommitment;
    constructor(address verifier_,bytes32 commitment_) {
        require(verifier_.code.length!=0 && commitment_!=bytes32(0),"configuration");
        verifier=verifier_;keyCommitment=commitment_;
    }
    receive() external payable {}
    function verify(bytes calldata key) external {
        require(block.chainid==1337 && F.txSender()==address(this),"sender/chain");
        require(F.currentFrameIndex()==0 && F.frameTarget(0)==address(this) && F.frameModeOf(0)==F.MODE_VERIFY && F.frameFlags(0)==2,"verify frame");
        require(F.signatureCount()==1 && F.signatureScheme(0)==F.SIG_SCHEME_ARBITRARY,"signature scheme");
        require(key.length==20544 && keccak256(key)==keyCommitment,"public key");
        require(IAtomicSignatureVerifier(verifier).verify(key,abi.encodePacked(F.sigHash()),F.arbitrarySignature(0)),"signature");
        F.approveScope(F.APPROVE_EXECUTION);
    }
    /// Anyone may fund this account's admission stake; no withdrawal authority is granted.
    function stakeForAltMempool() external payable {
        (bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));
        require(ok,"stake");
    }
}
