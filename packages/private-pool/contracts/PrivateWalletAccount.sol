// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ModularAccount} from "../../atomic/contracts/ModularAccount.sol";
/// Public PQ account; QRAFT sponsors its alternative-mempool stake.
contract PrivateWalletAccount is ModularAccount {
 address public immutable bootstrap;
 bool public bootstrapped;
 constructor(address bootstrap_){require(bootstrap_.code.length>0,"bootstrap");bootstrap=bootstrap_;}
 function bootstrapStake() external payable {
  require(msg.sender==bootstrap&&!bootstrapped&&msg.value==0.012 ether,"bootstrap only once");bootstrapped=true;
  (bool ok,)=address(0xD51c04d7A0B01124E84DE152F4e56d9eeCB22D2F).call{value:0.012 ether}(abi.encodeWithSignature("addStake(uint32)",uint32(86400)));require(ok,"stake balance");
 }
}
