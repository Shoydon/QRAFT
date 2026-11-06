// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
interface IAtomicFactory {function accounts(address) external view returns(bool);}
interface IAtomicPool {function denomination() external view returns(uint256);}
contract AtomicPaymaster {
    address public immutable owner;
    address public immutable factory;
    address public immutable pool;
    uint256 public immutable denomination;
    constructor(address owner_,address factory_,address pool_) {
        require(owner_!=address(0),"owner");owner=owner_;factory=factory_;pool=pool_;
        require(factory_.code.length!=0 && pool_.code.length!=0,"configuration");
        denomination=IAtomicPool(pool_).denomination();
    }
    receive() external payable {}
    function stake() external payable {
        require(msg.sender==owner,"owner");
        (bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));
        require(ok,"stake");
    }
    function fp(uint256 i,uint256 p) private view returns(uint256 v){assembly{v:=frameparam(i,p)}}
    function tp(uint256 p) private view returns(uint256 v){assembly{v:=txparam(p)}}
    function pay() external {
        require(block.chainid==1337 && F.currentFrameIndex()==1 && F.frameCount()==3,"shape");
        address sender=F.txSender();
        require(IAtomicFactory(factory).accounts(sender),"account");
        require(F.signatureCount()==1 && F.txNonce()<1000 && F.nonceKeyCount()==1 && F.nonceKey0()==0,"nonce/signatures");
        require(tp(6)<=1e12 && tp(3)<=1 && tp(4)<=128 && tp(5)==0 && tp(7)==0,"fees");
        require(F.frameTarget(0)==sender && F.frameModeOf(0)==1 && F.frameFlags(0)==2 && fp(0,8)==0,"authorization");
        bytes memory auth=F.frameData(0);
        require(auth.length==20612 && bytes4(auth)==bytes4(keccak256("verify(bytes)")),"auth data");
        require(F.frameTarget(1)==address(this) && F.frameModeOf(1)==1 && F.frameFlags(1)==1 && fp(1,8)==0 && F.frameDataLength(1)==4,"sponsor");
        require(fp(0,1)<=4000000 && fp(0,9)==0 && fp(1,1)<=120000 && fp(1,9)<=97920,"verify budget");
        require(F.frameTarget(2)==pool && F.frameModeOf(2)==2 && F.frameFlags(2)==0,"pool frame");
        require(fp(2,1)<=3000000 && fp(2,9)<=4000000,"execution budget");
        bytes memory action=F.frameData(2);
        bool deposit=action.length==36 && bytes4(action)==bytes4(keccak256("deposit(bytes32)")) && fp(2,8)==denomination;
        bool withdrawal=action.length==388 && bytes4(action)==bytes4(keccak256("withdraw(bytes32,bytes32,address,uint64,uint256[8])")) && fp(2,8)==0;
        require(deposit||withdrawal,"action");
        F.approveScope(F.APPROVE_PAYMENT);
    }
    function withdraw(address payable recipient,uint256 amount) external {require(msg.sender==owner,"owner");(bool ok,)=recipient.call{value:amount}("");require(ok,"payout");}
}
