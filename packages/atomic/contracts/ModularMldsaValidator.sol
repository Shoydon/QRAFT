// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
interface IModularKey {function keyCommitment() external view returns(bytes32);}
interface IModularVerifier {function verify(bytes calldata key,bytes calldata message,bytes calldata signature) external view returns(bool);}
/// Type-11 validator: STATICCALL from the account, all transaction context is introspected.
contract ModularMldsaValidator {
 address public immutable verifier;
 mapping(address=>bytes32) private overrides;
 mapping(address=>bool) private disabled;
 constructor(address verifier_){require(verifier_.code.length!=0,"verifier");verifier=verifier_;}
 function isModuleType(uint256 id) external pure returns(bool){return id==11;}
 function onInstall(bytes calldata data) external {
  require(data.length==32,"commitment");bytes32 commitment=abi.decode(data,(bytes32));require(commitment!=0,"key");
  overrides[msg.sender]=commitment;disabled[msg.sender]=false;
 }
 function onUninstall(bytes calldata) external {delete overrides[msg.sender];disabled[msg.sender]=true;}
 function validateFrame(bytes calldata key) external view returns(uint8){
  uint256 i=F.currentFrameIndex();
  if(block.chainid!=1337||msg.sender!=F.txSender()||F.frameTarget(i)!=msg.sender||F.frameModeOf(i)!=F.MODE_VERIFY||disabled[msg.sender])return 0;
  if(F.signatureCount()!=1||F.signatureScheme(0)!=F.SIG_SCHEME_ARBITRARY||key.length!=20544)return 0;
  bytes32 commitment=overrides[msg.sender];
  if(commitment==0){try IModularKey(msg.sender).keyCommitment() returns(bytes32 c){commitment=c;}catch{return 0;}}
  if(keccak256(key)!=commitment)return 0;
  bytes memory signature=F.arbitrarySignature(0);if(signature.length!=2420)return 0;
  try IModularVerifier(verifier).verify(key,abi.encodePacked(F.sigHash()),signature) returns(bool valid){return valid?uint8(2)&F.allowedScope(i):0;}catch{return 0;}
 }
}
