import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const constants=require('../node_modules/poseidon-lite/constants/2.js').default;
const hex=v=>Buffer.from(v,'base64').toString('hex').padStart(64,'0');
const rc=constants.C.map(hex).join('');
const matrix=constants.M.map(row=>row.map(v=>'0x'+hex(v)));
let pool=await readFile('protocol/contracts/NativePool.sol','utf8');
pool=pool.replace('contract NativePool','contract AtomicPool').replace('    IHasher public immutable hasher;','');
pool=pool.replace('constructor(address h, address v, uint256 amount)','constructor(address v, uint256 amount)').replace('h.code.length != 0 && ','').replace('hasher = IHasher(h); ','');
pool=pool.replaceAll('hasher.poseidon','poseidon');
pool=pool.replace('address recipient) public view returns','address recipient, uint64 expiry) public view returns').replace('QRAFT_NATIVE_ETH_WITHDRAWAL_V1','QRAFT_ATOMIC_ETH_WITHDRAWAL_V1').replace('nullifierHash, recipient));','nullifierHash, recipient, expiry, uint256(0)));');
pool=pool.replace('uint256[8] calldata proof) external','uint64 expiry, uint256[8] calldata proof) external').replace('require(roots[root],','require(block.timestamp <= expiry, "Proof expired");\n        require(roots[root],').replace('withdrawalDigest(root, nullifierHash, recipient)','withdrawalDigest(root, nullifierHash, recipient, expiry)');
const hash=`
    // Poseidon t=3, RF=8, RP=57, BN254, constants pinned to poseidon-lite 0.3.0 (MIT).
    // Included in the pool's runtime: no separately deployed hasher.
    function poseidon(bytes32[2] memory input) public pure returns(bytes32 output) {
        bytes memory constants=hex"${rc}";
        assembly ("memory-safe") {
            function fifth(x, p) -> y {let sq := mulmod(x,x,p) y := mulmod(mulmod(sq,sq,p),x,p)}
            let p := 21888242871839275222246405745257275088548364400416034343698204186575808495617
            let a := 0
            let b := mod(mload(input),p)
            let c := mod(mload(add(input,32)),p)
            for {let r := 0} lt(r,65) {r := add(r,1)} {
                let ptr := add(add(constants,32),mul(r,96))
                a := fifth(addmod(a,mload(ptr),p),p)
                b := addmod(b,mload(add(ptr,32)),p)
                c := addmod(c,mload(add(ptr,64)),p)
                if or(lt(r,4),gt(r,60)) {b := fifth(b,p) c := fifth(c,p)}
                let x := ${matrix[0].map((v,i)=>`mulmod(${['a','b','c'][i]},${v},p)`).reduce((a,b)=>`addmod(${a},${b},p)`)}
                let y := ${matrix[1].map((v,i)=>`mulmod(${['a','b','c'][i]},${v},p)`).reduce((a,b)=>`addmod(${a},${b},p)`)}
                c := ${matrix[2].map((v,i)=>`mulmod(${['a','b','c'][i]},${v},p)`).reduce((a,b)=>`addmod(${a},${b},p)`)}
                a := x b := y
            }
            output := a
        }
    }
`;
pool=pool.slice(0,pool.lastIndexOf('}'))+hash+'}\n';
await writeFile('packages/atomic/contracts/AtomicPool.sol',pool);
