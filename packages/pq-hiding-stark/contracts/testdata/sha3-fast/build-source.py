#!/usr/bin/env python3
"""Reproduce FastSha3_512 from pinned MIT permutation plus FIPS202 wrapper."""
from pathlib import Path
import hashlib,json
root=Path('packages/pq-hiding-stark/contracts')
p=root/'testdata/sha3-fast'
source=(p/'LibKeccak.sol').read_text()
assert hashlib.sha256(source.encode()).hexdigest()==json.loads((p/'upstream-pin.json').read_text())['upstreamSourceSha256']
base=(root/'src/Sha3_512.sol').read_text()
constants=source[source.index('    bytes internal constant ROUND_CONSTANTS'):source.index('    /// @notice A mask')]
helpers=source[source.index('            // set a state element'):source.index('            // Unroll the permutation loop.')]
permutation='   function permutation(stateMatrixPtr, rcPtr) {\n'+''.join(f'    permute(stateMatrixPtr, rcPtr, {i})\n' for i in range(24))+'   }\n'
sponge=base[base.index('   let pos:=add(input,32)'):base.index('\n  }\n }\n}\ncontract')].replace('permute(state,scratchB,scratchC,constants)','permutation(state,add(constants,32))')
# Absorb full tail lanes at once, and explicitly mask partial lanes. This is
# equivalent to bytewise absorption and ignores dirty bytes beyond input.length.
tail_start=sponge.index('   for {let i:=0} lt(i,remaining)')
tail_end=sponge.index('   // SHA3 domain suffix',tail_start)
sponge=sponge[:tail_start]+"""   let whole:=div(remaining,8)
   for {let i:=0} lt(i,whole) {i:=add(i,1)} {
    let q:=add(state,mul(i,32))
    mstore(q,xor(mload(q),swap64(shr(192,mload(add(pos,mul(i,8)))))))
   }
   let tail:=mod(remaining,8)
   if tail {
    let q:=add(state,mul(whole,32))
    let value:=and(swap64(shr(192,mload(add(pos,mul(whole,8))))),sub(shl(mul(tail,8),1),1))
    mstore(q,xor(mload(q),value))
   }
"""+sponge[tail_end:]
header='''// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
/// @notice Standard FIPS202 SHA3-512: 72-byte rate, 0x06 domain, 64-byte output.
/// @dev Keccak-f[1600] helpers/round schedule adapted from ethereum-optimism/lib-keccak
/// commit b1c60dc34b927e69be7e2281cc07dc065409e1fe (MIT), copyright2023 clabby;
/// attribution geohot. License and exact upstream source in testdata/sha3-fast/.
/// Only the sponge wrapper is SHA3-512-specific; this is NOT EVM keccak256.
/// No claim of an independent cryptographic audit or complete proof verification.
library FastSha3_512 {
    uint64 private constant U64_MASK = 0xFFFFFFFFFFFFFFFF;
'''
code=header+constants+''' function hash(bytes memory input) internal pure returns(bytes memory output) {
  uint256[25] memory state;
  bytes memory constants=ROUND_CONSTANTS;
  output=new bytes(64);
  assembly("memory-safe") {
   function swap64(v)->r {
    v:=or(shl(8,and(v,0x00ff00ff00ff00ff)),shr(8,and(v,0xff00ff00ff00ff00)))
    v:=or(shl(16,and(v,0x0000ffff0000ffff)),shr(16,and(v,0xffff0000ffff0000)))
    r:=or(shl(32,and(v,0x00000000ffffffff)),shr(32,v))
   }
'''+helpers+permutation+sponge+'\n  }\n }\n'+(p/'harness-and-node.sol.txt').read_text()
(root/'src/FastSha3_512.sol').write_text(code)
