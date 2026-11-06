/** Regenerate/check Solidity's canonical key and exact compiled component pins. */
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { keccak256 } from 'viem';
const check = process.argv.includes('--check');
const result = spawnSync('packages/pq-hiding-stark/target/release/examples/public_profile_v5', [], { encoding: 'utf8' });
if (result.status !== 0) throw Error('Build the public_profile_v5 native example first.');
const profile = JSON.parse(result.stdout);
if (profile.privateWitnessRead !== false || profile.width !== 6 || profile.degreeBits !== 12 || !/^[a-f0-9]{128}$/.test(profile.preprocessingRoot)) throw Error('Unexpected canonical public preprocessing shape.');
const codec = 'packages/pq-hiding-stark/contracts/src/WithdrawalProofCodecV5.sol';
const originalCodec = await readFile(codec, 'utf8');
const updatedCodec = originalCodec.replace(/(PREPROCESSING_ROOT=hex")[a-f0-9]+/, '$1' + profile.preprocessingRoot);
if (check && updatedCodec !== originalCodec) throw Error('The Solidity preprocessing root differs from the native canonical key.');
if (!check) await writeFile(codec, updatedCodec);
const specs = { AIR_CODE: ['AirProgram', 'AirProgram'], ARITHMETIC_CODE: ['WithdrawalSessionComponentsV5', 'WithdrawalSessionArithmeticV5'], AUTHENTICATION_CODE: ['WithdrawalSessionComponentsV5', 'WithdrawalSessionAuthenticationV5'], STREAM_CODE: ['WithdrawalSessionComponentsV5', 'WithdrawalSessionStreamV5'], BLOB_CODE: ['ProofBlobStore', 'ProofBlobStore'] };
const session = 'packages/pq-hiding-stark/contracts/src/WithdrawalVerifierSessionV5.sol';
const original = await readFile(session, 'utf8'); let updated = original;
for (const [constant, [file, name]] of Object.entries(specs)) {
  const artifact = JSON.parse(await readFile(`packages/pq-hiding-stark/contracts/out/${file}.sol/${name}.json`));
  updated = updated.replace(new RegExp(`(${constant}=)0x[a-f0-9]+`), '$1' + keccak256(artifact.deployedBytecode.object));
}
if (check && updated !== original) throw Error('Recompile and refresh the Solidity component runtime pins.');
if (!check) await writeFile(session, updated);
console.log(check ? 'Verified native canonical preprocessing root and five Solidity component pins.' : 'Updated native canonical preprocessing root and five Solidity component pins. Recompile and run --check.');
