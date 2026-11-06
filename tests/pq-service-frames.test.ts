import { expect, test } from 'bun:test';
import { getCreate2Address, keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { serviceFramePlan, signServiceFrame, verifyServiceFrame, serviceFrameSigner, SERVICE_NONCE_KEY, DEPLOYMENT_PROXY, DEPLOYMENT_PROXY_HASH } from '../src/lib/pq/service-frames';
import { decodeFrameTransaction, assertSuccessfulReceipt } from '../packages/frame-account/src/frametx';

const operator = privateKeyToAccount(`0x${'12'.repeat(32)}`);
const operation = { operator: operator.address, nonce: 7n, to: '0x0000000000000000000000000000000000001234' as Hex, data: '0x1234' as Hex, value: 123n, salt: keccak256('0x1234') };

test('public service calls use native EOA frames with the operator as sender and payer', async () => {
  const { tx } = serviceFramePlan(operation);
  const signed = signServiceFrame(tx, await operator.sign({ hash: tx.sigHash() }));
  const decoded = decodeFrameTransaction(signed.raw());
  expect(signed.raw().startsWith('0x06')).toBe(true);
  expect(decoded.nonceKeys).toEqual([SERVICE_NONCE_KEY]);
  expect(decoded.nonceSeq).toBe(7n);
  expect(decoded.frames.map(frame => [frame.mode, frame.flags])).toEqual([[1, 3], [2, 0]]);
  expect(decoded.frames[1]!.target).toBe(operation.to.toLowerCase() as Hex);
  expect(decoded.frames[1]!.value).toBe(123n);
  expect(await serviceFrameSigner(decoded)).toBe(operator.address);
  expect(verifyServiceFrame(signed.raw(), operation).sigHash()).toBe(tx.sigHash());
  expect(() => verifyServiceFrame(signed.raw(), { ...operation, nonce: 8n })).toThrow('differs');
  expect(() => verifyServiceFrame(signed.raw(), { ...operation, data: '0x1235' })).toThrow('differs');
});

test('public data deployment uses a deterministic CREATE2 proxy inside a native execution frame', () => {
  const deployment = { ...operation, to: undefined, value: 0n, data: '0x6001600c60003960016000f300' as Hex };
  const plan = serviceFramePlan(deployment);
  expect(plan.deployment).toBe(getCreate2Address({ from: DEPLOYMENT_PROXY, salt: deployment.salt, bytecode: deployment.data }));
  expect(plan.tx.frames[1]!.target).toBe(DEPLOYMENT_PROXY.toLowerCase() as Hex);
  expect(plan.tx.frames[1]!.data).toBe(`${deployment.salt}${deployment.data.slice(2)}`);
  expect(keccak256('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3')).toBe(DEPLOYMENT_PROXY_HASH);
  expect(() => serviceFramePlan({ ...deployment, value: 1n })).toThrow('cannot receive ETH');
});

test('native service receipts reject ordinary transactions, failed execution and missing frames', () => {
  const receipt = { type: '0x6' as Hex, status: '0x1' as Hex, payer: operator.address, frameReceipts: [{ status: '0x1' as Hex, gasUsed: '0x1' as Hex, logs: [] }, { status: '0x1' as Hex, gasUsed: '0x1' as Hex, logs: [] }] };
  expect(() => assertSuccessfulReceipt(receipt, 2)).not.toThrow();
  expect(() => assertSuccessfulReceipt({ ...receipt, type: '0x2' }, 2)).toThrow();
  expect(() => assertSuccessfulReceipt({ ...receipt, frameReceipts: [{ ...receipt.frameReceipts[0]!, status: '0x0' }, receipt.frameReceipts[1]!] }, 2)).toThrow();
  expect(() => assertSuccessfulReceipt({ ...receipt, frameReceipts: undefined }, 2)).toThrow();
});
