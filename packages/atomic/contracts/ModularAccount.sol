// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {LibERC8286 as F} from "../../frame-account/contracts/vendor/erc8286/lib/LibERC8286.sol";
interface IFrameModule {
 function isModuleType(uint256 id) external view returns(bool);
 function onInstall(bytes calldata data) external;
 function onUninstall(bytes calldata data) external;
 function validateFrame(bytes calldata data) external view returns(uint8);
}
/// ERC-8286 protocol-dispatched account. Initial configuration is immutable clone data.
contract ModularAccount {
 mapping(address=>bool) private installed;
 mapping(address=>bool) private removed;
 event ModuleInstalled(uint256 moduleTypeId,address module);
 event ModuleUninstalled(uint256 moduleTypeId,address module);
 modifier onlySelf(){require(msg.sender==address(this),"unauthorized");_;}
 receive() external payable {}
 function configuration() public view returns(address validator,bytes32 commitment){
  require(address(this).code.length==100,"clone configuration");
  bytes memory data=new bytes(55);
  assembly {extcodecopy(address(),add(data,32),45,55) validator:=shr(96,mload(add(data,32))) commitment:=mload(add(data,55))}
  require(uint8(data[20])==2&&uint8(data[21])==15&&uint8(data[22])==0,"configuration policy");
 }
 function keyCommitment() external view returns(bytes32 commitment){(,commitment)=configuration();}
 function accountId() external pure returns(string memory){return "qraft.erc8286.1.0.0";}
 function supportsModule(uint256 id) external pure returns(bool){return id==11;}
 function executionRoute() external pure returns(uint8){return 0;}
 function supportsApprovalMode(uint8 mode) public pure returns(bool){return mode==2;}
 function supportsExecutionMode(bytes32 mode) public pure returns(bool){return mode==F.FRAME_MODE_SINGLE||mode==F.FRAME_MODE_SINGLE_ATOMIC||mode==F.FRAME_MODE_BATCH||mode==F.FRAME_MODE_BATCH_ATOMIC;}
 function isModuleInstalled(uint256 id,address module,bytes memory) public view returns(bool){
  if(id!=11||removed[module])return false;
  (address initial,)=configuration();return module==initial||installed[module];
 }
 function installModule(uint256 id,address module,bytes calldata data) external onlySelf {
  require(id==11&&module.code.length!=0&&IFrameModule(module).isModuleType(11),"module type");
  require(!isModuleInstalled(id,module,""),"installed");
  installed[module]=true;removed[module]=false;IFrameModule(module).onInstall(data);emit ModuleInstalled(id,module);
 }
 function uninstallModule(uint256 id,address module,bytes calldata data) external onlySelf {
  require(isModuleInstalled(id,module,""),"missing module");
  installed[module]=false;removed[module]=true;IFrameModule(module).onUninstall(data);emit ModuleUninstalled(id,module);
 }
 function verify(bytes calldata data) external returns(uint8){
  uint256 i=F.currentFrameIndex();
  require(block.chainid==1337&&F.txSender()==address(this)&&F.frameTarget(i)==address(this)&&F.frameModeOf(i)==F.MODE_VERIFY,"verify context");
  address module=F.validatorFromNonceKey();require(isModuleInstalled(11,module,""),"validator");
  uint8 granted=IFrameModule(module).validateFrame(data)&F.allowedScope(i)&2;
  for(uint256 j=0;j<F.frameCount();j++)if(F.frameModeOf(j)==F.MODE_SENDER){
   require(supportsExecutionMode(F.presentedMode(j,F.senderFrameCount()>1)),"execution mode");
  }
  require(granted!=0&&supportsApprovalMode(granted),"validation");F.approveScope(granted);return granted;
 }
 function stakeForAltMempool() external payable {
  require(block.chainid==1337&&msg.value>0,"stake configuration");
  (bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:msg.value}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake");
 }
}
