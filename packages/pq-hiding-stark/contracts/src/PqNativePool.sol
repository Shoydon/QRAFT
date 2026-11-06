// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {FastSha3_512} from "./FastSha3_512.sol";
import {Blake2b_512} from "./Blake2b_512.sol";

/// @notice Exact complete-statement consumption interface. Implementations must
/// verify the full proof and bind the consumer to msg.sender before consumption.
interface IPqWithdrawalConsumer {
    function consumeVerifiedWithdrawal(bytes32[2] calldata root,bytes32[2] calldata nullifier,
        bytes32[2] calldata contextDigest,bytes32 sessionId) external returns(bool);
}

/// @notice Fixed-denomination native ETH pool with a depth32 SHA3-512 note tree.
/// @dev Custody depends on the pinned verifier actually establishing complete
/// proof validity/knowledge/ZK. This pool is not itself a proof verifier, and its
/// constructor accepting a code hash is not a cryptographic security certificate.
/// No owner, admin withdrawal, mutable verifier or alternate acceptance path.
contract PqNativePool {
    uint256 public constant DEPTH = 32;
    uint256 public constant CAPACITY = 1 << 32;
    uint128 public immutable denomination;
    IPqWithdrawalConsumer public immutable verifier;
    bytes32 public immutable verifierCodeHash;
    uint256 public nextIndex;
    bytes32[2] private latestRoot;
    bytes32[2][32] private zeros;
    bytes32[2][32] private filled;
    mapping(bytes32=>mapping(bytes32=>bool)) private roots;
    mapping(bytes32=>mapping(bytes32=>bool)) private commitments;
    mapping(bytes32=>mapping(bytes32=>bool)) private spent;
    uint256 private entered = 1;
    bytes private constant CONTEXT_DOMAIN = "QRAFT-WITHDRAW-CONTEXT-v2\x00";

    error InvalidDenomination();
    error InvalidVerifier();
    error VerifierCodeChanged();
    error WrongDepositValue();
    error ZeroCommitment();
    error DuplicateCommitment();
    error TreeFull();
    error UnknownRoot();
    error ZeroNullifier();
    error NullifierSpent();
    error InvalidRecipient();
    error InvalidRelayer();
    error InvalidFee();
    error Expired();
    error InvalidProof();
    error PayoutFailed();
    error Reentrancy();
    error InvalidLevel();

    event Deposit(bytes32 commitmentHi,bytes32 commitmentLo,uint32 indexed index,
        bytes32 rootHi,bytes32 rootLo);
    event Withdrawal(bytes32 nullifierHi,bytes32 nullifierLo,address indexed recipient,
        address indexed relayer,uint128 fee,bytes32 sessionId);

    modifier nonReentrant(){
        if(entered!=1)revert Reentrancy();entered=2;_;entered=1;
    }
    constructor(uint128 amount,address verifierAddress,bytes32 expectedCodeHash){
        if(amount==0)revert InvalidDenomination();
        if(verifierAddress.code.length==0 || expectedCodeHash==bytes32(0) ||
            verifierAddress.codehash!=expectedCodeHash)revert InvalidVerifier();
        denomination=amount;verifier=IPqWithdrawalConsumer(verifierAddress);
        verifierCodeHash=expectedCodeHash;
        bytes32[2] memory zero;
        for(uint256 level;level<DEPTH;++level){
            zeros[level]=zero;zero=FastSha3_512.node(zero,zero);
        }
        latestRoot=zero;roots[zero[0]][zero[1]]=true;
    }
    function currentRoot() external view returns(bytes32[2] memory){return latestRoot;}
    function zeroAt(uint256 level) external view returns(bytes32[2] memory){
        if(level>=DEPTH)revert InvalidLevel();return zeros[level];
    }
    function isKnownRoot(bytes32[2] calldata root) external view returns(bool){return roots[root[0]][root[1]];}
    function isSpent(bytes32[2] calldata nullifier) external view returns(bool){return spent[nullifier[0]][nullifier[1]];}
    function isDeposited(bytes32[2] calldata commitment) external view returns(bool){return commitments[commitment[0]][commitment[1]];}

    function deposit(bytes32[2] calldata commitment) external payable nonReentrant returns(uint32 index){
        if(msg.value!=denomination)revert WrongDepositValue();
        if(commitment[0]==0 && commitment[1]==0)revert ZeroCommitment();
        if(commitments[commitment[0]][commitment[1]])revert DuplicateCommitment();
        uint256 cursor=nextIndex;if(cursor>=CAPACITY)revert TreeFull();
        index=uint32(cursor);nextIndex=cursor+1;
        commitments[commitment[0]][commitment[1]]=true;
        bytes32[2] memory node=commitment;
        for(uint256 level;level<DEPTH;++level){
            if(cursor&1==0){filled[level]=node;node=FastSha3_512.node(node,zeros[level]);}
            else node=FastSha3_512.node(filled[level],node);
            cursor>>=1;
        }
        latestRoot=node;roots[node[0]][node[1]]=true;
        emit Deposit(commitment[0],commitment[1],index,node[0],node[1]);
    }

    /// @notice Derives the exact Rust WithdrawalContext byte encoding and BLAKE2b-512.
    /// chainid:u256, pool:address, asset=0:address, denomination:u128,
    /// recipient:address, relayer:address, fee:u128, deadline:u64; all integers BE.
    function withdrawalContext(address recipient,address relayer,uint128 fee,uint64 deadline)
        public view returns(bytes32[2] memory result)
    {
        bytes memory encoded=abi.encodePacked(CONTEXT_DOMAIN,uint256(block.chainid),address(this),
            address(0),denomination,recipient,relayer,fee,deadline);
        bytes memory digest=Blake2b_512.hash(encoded);
        assembly("memory-safe") {
            mstore(result,mload(add(digest,32)))mstore(add(result,32),mload(add(digest,64)))
        }
    }
    function withdraw(bytes32[2] calldata root,bytes32[2] calldata nullifier,
        address payable recipient,address payable relayer,uint128 fee,uint64 deadline,
        bytes32 sessionId) external nonReentrant
    {
        if(recipient==address(0) || recipient==address(this))revert InvalidRecipient();
        if(fee>denomination)revert InvalidFee();
        if(fee!=0 && (relayer==address(0) || relayer==address(this)))revert InvalidRelayer();
        if(block.timestamp>deadline)revert Expired();
        if(!roots[root[0]][root[1]])revert UnknownRoot();
        if(nullifier[0]==0 && nullifier[1]==0)revert ZeroNullifier();
        if(spent[nullifier[0]][nullifier[1]])revert NullifierSpent();
        if(address(verifier).codehash!=verifierCodeHash)revert VerifierCodeChanged();
        bytes32[2] memory context=withdrawalContext(recipient,relayer,fee,deadline);
        // Effects before external verifier/payout; any failure rolls back both
        // this mark and the verifier's consumption in the same transaction.
        spent[nullifier[0]][nullifier[1]]=true;
        if(!verifier.consumeVerifiedWithdrawal(root,nullifier,context,sessionId))revert InvalidProof();
        uint256 amount=uint256(denomination)-fee;
        if(amount!=0){(bool ok,)=recipient.call{value:amount}("");if(!ok)revert PayoutFailed();}
        if(fee!=0){(bool ok,)=relayer.call{value:fee}("");if(!ok)revert PayoutFailed();}
        emit Withdrawal(nullifier[0],nullifier[1],recipient,relayer,fee,sessionId);
    }
}
