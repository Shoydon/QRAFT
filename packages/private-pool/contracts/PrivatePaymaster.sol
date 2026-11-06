// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
/// Devnet sponsor. Pool proofs remain the authority over private funds.
contract PrivatePaymaster {
 address public immutable owner;address public immutable implementation;address public immutable validator;address public immutable pool;
 constructor(address owner_,address implementation_,address validator_,address pool_){require(owner_!=address(0)&&implementation_.code.length>0&&validator_.code.length>0&&pool_.code.length>0,"configuration");owner=owner_;implementation=implementation_;validator=validator_;pool=pool_;}
 receive() external payable {}
 function supportsAccount(address account) public view returns(bool){bytes memory code=account.code;if(code.length!=100)return false;bytes32 commitment;assembly{commitment:=mload(add(code,100))}return commitment!=0&&keccak256(code)==keccak256(abi.encodePacked(hex"363d3d373d3d3d363d73",implementation,hex"5af43d82803e903d91602b57fd5bf3",validator,uint8(2),uint8(15),uint8(0),commitment));}
 function fp(uint256 i,uint256 p) private view returns(uint256 v){assembly{v:=frameparam(i,p)}}
 function tp(uint256 p) private view returns(uint256 v){assembly{v:=txparam(p)}}
 function pay() external {
  require(block.chainid==1337&&F.currentFrameIndex()==1&&F.frameCount()==3,"shape");address sender=F.txSender();
  require(supportsAccount(sender)&&F.signatureCount()==1&&F.nonceKeyCount()==1&&F.nonceKey0()==uint160(validator),"account");
  require(tp(6)<=1e12&&tp(3)<=1&&tp(4)<=128&&tp(5)==0&&tp(7)==0,"fees");
  require(F.frameTarget(0)==sender&&F.frameModeOf(0)==1&&F.frameFlags(0)==2&&fp(0,8)==0,"authorization");
  bytes memory auth=F.frameData(0);require(auth.length==20612&&bytes4(auth)==bytes4(keccak256("verify(bytes)")),"auth data");
  require(F.frameTarget(1)==address(this)&&F.frameModeOf(1)==1&&F.frameFlags(1)==1&&fp(1,8)==0&&F.frameDataLength(1)==4,"sponsor");
  require(fp(0,1)<=4500000&&fp(0,9)==0&&fp(1,1)<=200000&&fp(1,9)<=97920,"verification budget");
  require(F.frameTarget(2)==pool&&F.frameModeOf(2)==2&&F.frameFlags(2)==0&&fp(2,1)<=3000000&&fp(2,9)<=8000000,"pool");
  bytes memory action=F.frameData(2);
  require(action.length>=836&&action.length<=4096&&bytes4(action)==bytes4(keccak256("transact((uint256,uint8,uint128,uint128,address,uint64,uint256[4],uint256[2],bytes[2]),uint256[8])")),"action");
  F.approveScope(F.APPROVE_PAYMENT);
 }
 function stake() external payable {require(msg.sender==owner,"owner");(bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake");}
 function withdraw(address payable recipient,uint256 amount) external {require(msg.sender==owner,"owner");(bool ok,)=recipient.call{value:amount}("");require(ok,"payout");}
}
