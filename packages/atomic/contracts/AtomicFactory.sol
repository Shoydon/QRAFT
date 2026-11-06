// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {AtomicAccount} from "./AtomicAccount.sol";
contract AtomicFactory {
    address public immutable verifier;
    mapping(address=>bool) public accounts;
    event AccountCreated(address indexed account,bytes32 indexed commitment);
    constructor(address verifier_) {require(verifier_.code.length!=0,"verifier");verifier=verifier_;}
    function create(bytes32 commitment,bytes32 salt) external returns(address account) {
        account=address(new AtomicAccount{salt:keccak256(abi.encode(commitment,salt))}(verifier,commitment));
        accounts[account]=true;emit AccountCreated(account,commitment);
    }
}
