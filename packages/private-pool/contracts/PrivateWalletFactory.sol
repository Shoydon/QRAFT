// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
interface IFactoryVerifier {function verify(bytes calldata,bytes calldata,bytes calldata) external view returns(bool);}
interface ISetupSponsor {function fundSetup(bytes32 commitment) external;}
interface IFactoryWallet {function setupStake() external payable;function setupComplete() external view returns(bool);}
/// Permissionless public-account creation authorized by the new owner's PQ key.
contract PrivateWalletFactory {
 address public immutable owner;IFactoryVerifier public immutable verifier;
 mapping(bytes32=>bool) public completed;
 receive() external payable {require(msg.sender==paymaster,"sponsor only");}
 address public implementation;address public validator;address public paymaster;
 constructor(address owner_,address verifier_){require(owner_!=address(0)&&verifier_.code.length>0,"configuration");owner=owner_;verifier=IFactoryVerifier(verifier_);}
 function initialize(address implementation_,address validator_,address paymaster_) external {
  require(msg.sender==owner&&implementation==address(0),"initialize once");
  require(implementation_.code.length>0&&validator_.code.length>0&&paymaster_.code.length>0,"configuration");
  implementation=implementation_;validator=validator_;paymaster=paymaster_;
 }
 function configuration(bytes32 commitment) public view returns(bytes memory){return abi.encodePacked(validator,uint8(2),uint8(15),uint8(0),commitment);}
 event AccountCreated(address indexed account, bytes32 indexed commitment);
 function initCode(bytes32 commitment) private view returns(bytes memory){bytes memory args=configuration(commitment);return abi.encodePacked(hex"61",uint16(args.length+0x2d),hex"3d81600a3d39f3363d3d373d3d3d363d73",implementation,hex"5af43d82803e903d91602b57fd5bf3",args);}
 function predict(bytes32 commitment) public view returns(address){return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff),address(this),commitment,keccak256(initCode(commitment)))))));}
 function nonceKey(bytes32 commitment) public view returns(uint256){return uint256(keccak256(abi.encode("QRAFT_FACTORY_V1",block.chainid,address(this),commitment)));}
 function fp(uint256 i,uint256 p) private view returns(uint256 v){assembly{v:=frameparam(i,p)}}
 function tp(uint256 p) private view returns(uint256 v){assembly{v:=txparam(p)}}
 function verify(bytes calldata key) external {
  require(block.chainid==1337&&implementation!=address(0)&&F.txSender()==address(this)&&F.currentFrameIndex()==0&&F.frameCount()==3,"shape");
  require(key.length==20544&&F.signatureCount()==1&&F.signatureScheme(0)==0,"key/signature");
  bytes32 commitment=keccak256(key);require(commitment!=0&&F.nonceKeyCount()==1&&F.nonceKey0()==nonceKey(commitment),"nonce");
  require(!completed[commitment],"already setupComplete");
  require(tp(6)<=1e12&&tp(3)<=1&&tp(4)<=128&&tp(5)==0&&tp(7)==0,"fees");
  require(F.frameTarget(0)==address(this)&&F.frameModeOf(0)==1&&F.frameFlags(0)==2&&fp(0,8)==0&&fp(0,1)<=4500000&&fp(0,9)==0,"authorization");
  require(keccak256(F.frameData(0))==keccak256(abi.encodeCall(this.verify,(key))),"auth data");
  require(F.frameTarget(1)==paymaster&&F.frameModeOf(1)==1&&F.frameFlags(1)==1&&fp(1,8)==0&&fp(1,1)<=200000&&fp(1,9)<=97920,"sponsor");
  require(keccak256(F.frameData(1))==keccak256(abi.encodeWithSignature("pay()")),"sponsor data");
  require(F.frameTarget(2)==address(this)&&F.frameModeOf(2)==2&&F.frameFlags(2)==0&&fp(2,8)==0&&fp(2,1)<=2000000&&fp(2,9)<=8000000,"execution");
  require(keccak256(F.frameData(2))==keccak256(abi.encodeCall(this.create,(commitment))),"creation data");
  bytes memory signature=F.arbitrarySignature(0);require(signature.length==2420&&verifier.verify(key,abi.encodePacked(F.sigHash()),signature),"signature");
  F.approveScope(F.APPROVE_EXECUTION);
 }
 function create(bytes32 commitment) external {
  require(msg.sender==address(this)&&F.txSender()==address(this)&&F.currentFrameIndex()==2,"self");
  require(!completed[commitment],"already setupComplete");completed[commitment]=true;
  address account=predict(commitment);
  if(account.code.length==0){bytes memory code=initCode(commitment);assembly ("memory-safe"){account:=create2(0,add(code,32),mload(code),commitment)}require(account!=address(0),"create2 failed");emit AccountCreated(account,commitment);}
  require(keccak256(account.code)==keccak256(abi.encodePacked(hex"363d3d373d3d3d363d73",implementation,hex"5af43d82803e903d91602b57fd5bf3",configuration(commitment))),"account code");
  ISetupSponsor(paymaster).fundSetup(commitment);
  IFactoryWallet(account).setupStake{value:0.012 ether}();
 }
 function stake() external payable {require(msg.sender==owner,"owner");(bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake");}
}
