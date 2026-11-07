// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
import {PrivatePool} from "./PrivatePool.sol";
/// Keyless execution approval for one precisely bound private-pool action.
/// No public wallet identity or offchain signer participates in private submission.
contract PrivateProofAccount {
 PrivatePool public immutable pool;
 address public immutable owner;address public paymaster;
 constructor(address pool_,address owner_){require(pool_.code.length>0&&owner_!=address(0),"configuration");pool=PrivatePool(pool_);owner=owner_;}
 function initialize(address paymaster_) external {require(msg.sender==owner&&paymaster==address(0)&&paymaster_.code.length>0,"initialize once");paymaster=paymaster_;}
 function fp(uint256 i,uint256 p) private view returns(uint256 v){assembly{v:=frameparam(i,p)}}
 function tp(uint256 p) private view returns(uint256 v){assembly{v:=txparam(p)}}
 function verify() external {
  require(block.chainid==1337&&F.txSender()==address(this)&&F.currentFrameIndex()==0&&F.frameCount()==3,"shape");
  require(F.signatureCount()==0&&F.nonceKeyCount()==1&&F.txNonce()==0,"nonce/signatures");
  require(tp(6)<=1e12&&tp(3)==1&&tp(4)==128&&tp(5)==0&&tp(7)==0,"fees");
  require(F.frameTarget(0)==address(this)&&F.frameModeOf(0)==1&&F.frameFlags(0)==2&&F.frameDataLength(0)==4&&fp(0,8)==0,"authorization");
  require(fp(0,1)==1500000&&fp(0,9)==0,"verification budget");
  require(F.frameTarget(1)==paymaster&&paymaster!=address(0)&&F.frameModeOf(1)==1&&F.frameFlags(1)==1&&fp(1,8)==0&&fp(1,1)==200000&&fp(1,9)==97920,"sponsor");
  bytes memory sponsor=F.frameData(1);require(sponsor.length==4&&bytes4(sponsor)==bytes4(keccak256("pay()")),"sponsor data");
  require(F.frameTarget(2)==address(pool)&&F.frameModeOf(2)==2&&F.frameFlags(2)==0&&fp(2,8)==0&&fp(2,1)==3000000&&fp(2,9)==8000000,"pool frame");
  bytes memory data=F.frameData(2);require(data.length>=836&&data.length<=4096&&bytes4(data)==PrivatePool.transact.selector,"action");
  bytes memory args=new bytes(data.length-4);for(uint256 i;i<args.length;i++)args[i]=data[i+4];
  (PrivatePool.Action memory action,uint256[8] memory proof)=abi.decode(args,(PrivatePool.Action,uint256[8]));
  require(action.kind!=0&&action.deposit==0,"private only");
  require(keccak256(data)==keccak256(abi.encodeCall(PrivatePool.transact,(action,proof))),"canonical action");
  bytes32 id=pool.validateAction(action,proof);
  require(uint256(id)!=0&&F.nonceKey0()==uint256(id),"action nonce");
  F.approveScope(F.APPROVE_EXECUTION);
 }
 function stake() external payable {require(msg.sender==owner,"owner");(bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake");}
}
