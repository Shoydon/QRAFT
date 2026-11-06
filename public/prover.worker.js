/* Only proof and public signals leave this worker. Never log witness material. */
importScripts('/proving/snarkjs.min.js');
self.onmessage = async ({ data }) => {
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(data.input, data.wasm, data.zkey, undefined, undefined, { singleThread: true });
    self.postMessage({ stage: 'verifying' });
    if (!await snarkjs.groth16.verify(data.verificationKey, publicSignals, proof)) throw Error('Local proof verification failed. Nothing was submitted.');
    const encoded = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
    const words = encoded.match(/0x[0-9a-fA-F]+/g);
    if (!words || words.length !== 13) throw Error('Unexpected proof shape');
    self.postMessage({ proof: words.slice(0, 8).map(word => BigInt(word).toString()), publicSignals });
  } catch { self.postMessage({ error: 'Proof generation failed. Your note is unchanged; nothing was submitted.' }); }
};
