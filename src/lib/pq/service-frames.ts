/** Public setup/computation transactions. Operator authorization never grants user custody. */
import { concat, getCreate2Address, numberToHex, recoverAddress, type Hex } from 'viem';
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, decodeFrameTransaction } from '../../../packages/frame-account/src/frametx';

export const SERVICE_NONCE_KEY = 0x5152414654n;
export const DEPLOYMENT_PROXY = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Hex;
export const DEPLOYMENT_PROXY_HASH = '0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989' as Hex;

export interface ServiceFrameOperation { chainId?: number; nonceKey?: bigint; operator: Hex; nonce: number | bigint; data: Hex; to?: Hex; value?: bigint; salt: Hex }

export function serviceFramePlan(operation: ServiceFrameOperation) {
  const { operator, nonce, data, to, salt } = operation;
  const value = operation.value ?? 0n;
  if (!to && value !== 0n) throw Error('Public data deployment cannot receive ETH.');
  const deployment = !to ? getCreate2Address({ from: DEPLOYMENT_PROXY, salt, bytecode: data }) : null;
  const tx = new FrameTx({ chainId: operation.chainId ?? 8141, nonceKeys: [operation.nonceKey ?? SERVICE_NONCE_KEY], nonceSeq: nonce, sender: operator,
    maxPriorityFee: 1n, maxFee: 128n, signatures: [new FrameSig({ scheme: SigScheme.SECP256K1, signer: operator, signature: `0x${'00'.repeat(65)}` })], frames: [
      new Frame({ mode: FrameMode.VERIFY, flags: 3, target: operator, gasLimit: 30000n, stateGasLimit: 97920n, data: '0x' }),
      new Frame({ mode: FrameMode.SENDER, target: to ?? DEPLOYMENT_PROXY, gasLimit: operation.chainId === 1337 && !to ? 8000000n : 14500000n, stateGasLimit: operation.chainId === 1337 ? to ? 10000000n : 16000000n : 40000000n, value, data: to ? data : concat([salt, data]) }),
    ] });
  return { tx, deployment };
}

export function signServiceFrame(plan: FrameTx, signature: Hex): FrameTx {
  if(signature.length!==132)throw Error('Expected a 65-byte operator signature.');
  const recovery=Number.parseInt(signature.slice(-2),16);
  const parity=recovery>=27?recovery-27:recovery;
  if(parity!==0&&parity!==1)throw Error('Invalid operator signature recovery id.');
  // Ethrex's native SECP256K1 scheme encodes v || r || s, with v in {0,1}.
  const wire=concat([numberToHex(parity,{size:1}),signature.slice(0,-2) as Hex]);
  const signed = new FrameTx({ ...plan, signatures: [new FrameSig({ scheme: SigScheme.SECP256K1, signer: plan.sender, signature:wire })] });
  if (signed.sigHash() !== plan.sigHash()) throw Error('Operator signature changed the frozen service transaction.');
  return signed;
}

export function serviceFrameSigner(tx:FrameTx):Promise<Hex>{
  const signature=tx.signatures[0]!.signature;
  const parity=Number.parseInt(signature.slice(2,4),16);
  if(parity!==0&&parity!==1)throw Error('Invalid native signature recovery id.');
  return recoverAddress({hash:tx.sigHash(),signature:concat([`0x${signature.slice(4)}`,numberToHex(parity+27,{size:1})])});
}

export function verifyServiceFrame(raw: Hex, operation: ServiceFrameOperation): FrameTx {
  const actual = decodeFrameTransaction(raw);
  const expected = serviceFramePlan(operation).tx;
  if (actual.sigHash() !== expected.sigHash() || actual.signatures[0]?.scheme !== SigScheme.SECP256K1 || actual.signatures[0].signature.length !== 132)
    throw Error('Saved native service transaction differs from the public operation.');
  return actual;
}
