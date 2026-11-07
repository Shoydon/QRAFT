// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ModularAccount} from "../../atomic/contracts/ModularAccount.sol";
/// Public PQ account; QRAFT sponsors its alternative-mempool stake.
contract PrivateWalletAccount is ModularAccount {
 address public immutable factory;
 bool public setupComplete;
 constructor(address factory_){require(factory_.code.length>0,"factory");factory=factory_;}
 function setupStake() external payable {
  require(msg.sender==factory&&!setupComplete&&msg.value==0.012 ether,"factory only once");setupComplete=true;
  (bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:0.012 ether}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake balance");
 }
}
