// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IHasher {
    function poseidon(bytes32[2] calldata input) external pure returns (bytes32);
}
interface ISpendVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
        uint256[2] calldata c, uint256[5] calldata signals) external view returns (bool);
}

/// Native ETH adaptation of Himitsu's depth-10 Poseidon private-note pool.
/// No token, allowance, operator, upgrade key, or administrative withdrawal.
contract NativePool {
    uint256 public constant LEVELS = 10;
    uint256 public constant CAPACITY = 1 << LEVELS;
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    IHasher public immutable hasher;
    ISpendVerifier public immutable verifier;
    uint256 public immutable denomination;
    uint256 public nextIndex;
    uint256 public withdrawalCount;
    bytes32 public currentRoot;
    bytes32[10] public zeros;
    bytes32[10] private filled;
    mapping(bytes32 => bool) public roots;
    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public spent;
    uint256 private entered = 1;

    event Deposit(bytes32 indexed commitment, uint32 leafIndex, bytes32 root);
    event Withdrawal(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount);

    modifier nonReentrant() {
        require(entered == 1, "Reentrancy"); entered = 2; _; entered = 1;
    }
    constructor(address h, address v, uint256 amount) {
        require(h.code.length != 0 && v.code.length != 0 && amount != 0, "Invalid configuration");
        hasher = IHasher(h); verifier = ISpendVerifier(v); denomination = amount;
        bytes32 zero = bytes32(uint256(keccak256("himitsu.empty.leaf")) % FIELD);
        for (uint256 i; i < LEVELS; ++i) {
            zeros[i] = zero; filled[i] = zero; zero = hasher.poseidon([zero, zero]);
        }
        currentRoot = zero; roots[zero] = true;
    }
    function deposit(bytes32 commitment) external payable nonReentrant {
        require(msg.value == denomination, "Wrong ETH amount");
        require(uint256(commitment) < FIELD && commitment != bytes32(0), "Invalid commitment");
        require(!commitments[commitment], "Duplicate commitment");
        uint256 index = nextIndex;
        require(index < CAPACITY, "Pool is full");
        commitments[commitment] = true; nextIndex = index + 1;
        bytes32 node = commitment;
        uint256 cursor = index;
        for (uint256 i; i < LEVELS; ++i) {
            if (cursor & 1 == 0) { filled[i] = node; node = hasher.poseidon([node, zeros[i]]); }
            else { node = hasher.poseidon([filled[i], node]); }
            cursor >>= 1;
        }
        currentRoot = node; roots[node] = true;
        emit Deposit(commitment, uint32(index), node);
    }
    /// Full 256-bit domain binding split into the circuit's two 128-bit limbs.
    function withdrawalDigest(bytes32 root, bytes32 nullifierHash, address recipient) public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("QRAFT_NATIVE_ETH_WITHDRAWAL_V1"),
            block.chainid, address(this), denomination, root, nullifierHash, recipient));
    }
    function withdraw(bytes32 root, bytes32 nullifierHash, address payable recipient,
        uint256[8] calldata proof) external nonReentrant {
        require(recipient != address(0) && recipient != address(this), "Invalid recipient");
        require(roots[root], "Unknown root");
        require(!spent[nullifierHash], "Note already spent");
        uint256 digest = uint256(withdrawalDigest(root, nullifierHash, recipient));
        uint256[5] memory signals = [uint256(root), uint256(nullifierHash), uint256(uint160(address(recipient))), digest >> 128, uint256(uint128(digest))];
        // Mark before external calls. A failed proof or payout rolls everything back.
        spent[nullifierHash] = true;
        require(verifier.verifyProof([proof[0],proof[1]], [[proof[2],proof[3]],[proof[4],proof[5]]], [proof[6],proof[7]], signals), "Invalid proof");
        withdrawalCount += 1;
        (bool ok,) = recipient.call{value: denomination}("");
        require(ok, "ETH payout failed");
        emit Withdrawal(nullifierHash, recipient, denomination);
    }
}
