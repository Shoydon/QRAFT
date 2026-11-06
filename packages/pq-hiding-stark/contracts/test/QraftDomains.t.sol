// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {CShake256V5} from "../src/CShake256V5.sol";
import {BlakeMerkle} from "../src/BlakeMerkle.sol";
import {BlakeMerkleV5} from "../src/BlakeMerkleV5.sol";
import {IndexedBlakeMerkleV4} from "../src/IndexedBlakeMerkleV4.sol";

/// Independent PyCryptodome/hashlib vectors for the QRAFT protocol namespace.
contract QraftDomainsTest {
    function testCshakeMatchesIndependentVector() public pure {
        bytes memory output = CShake256V5.stream(new bytes(64), new bytes(64));
        require(output.length == 2560, "stream length");
        require(keccak256(output) == 0x85b3ad97e0a196fbad9e58efc977f19c9297449c7d39e2b7f7a5b01e625b3ec1, "cSHAKE namespace vector");
    }
    function testMerkleDomainsMatchIndependentVectors() public view {
        bytes[] memory rows = new bytes[](1);
        bytes[] memory salts = new bytes[](1);
        rows[0] = hex"0100000000000000";
        salts[0] = hex"0200000000000000";
        {
            BlakeMerkle.Digest memory digest = BlakeMerkle.leaf(rows, salts);
            require(digest.a == 0x2cc98e1b8a3bcefd2e585ec5dcd5761290546bc9ff75e79077e9acf21d2bded2 && digest.b == 0x7e0e0c9a9c7b7880ca9989c5bd0b15b6d5c00d877bb988dc0e361dc743ae087a, "v1 leaf namespace vector");
        }
        {
            IndexedBlakeMerkleV4.Digest memory digest = IndexedBlakeMerkleV4.leaf(rows, salts, 0);
            require(digest.a == 0x982ee594e0663675a93332f865fc040d6bd3a5b811f15a46ee9205717b96a6c1 && digest.b == 0x64eefc795e011a14c79daa433099eaa3feb07c49acf0fcfba858c94adaac0006, "v4 leaf namespace vector");
        }
        {
            BlakeMerkleV5.Digest memory digest = BlakeMerkleV5.leaf(rows, salts);
            require(digest.a == 0x29c112ff46321178b3dcbdfec18b46a917750ceeb2e24b084e08a0b69c6d994a && digest.b == 0x2b7a0bc13963cd382c920b214e7a148bfa426723d056953b7edf63bd4a3fcec0, "v5 leaf namespace vector");
        }
    }
}
