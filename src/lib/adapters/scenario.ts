'use client';

/**
 * Demo scenarios. These exist so every designed state can be reached during a
 * demo without a deployed contract. They live behind the Demo mode banner, not
 * in the deposit or withdraw journey.
 *
 * A real backend has no equivalent: `chainBackend` ignores this module.
 */

export const SCENARIOS = [
  { id: 'happy', label: 'Normal', group: 'Default' },
  { id: 'insufficient-balance', label: 'Insufficient balance', group: 'Funding' },
  { id: 'deposit-not-sent', label: 'Wallet rejected the deposit', group: 'Deposit' },
  { id: 'deposit-unknown', label: 'Deposit outcome unknown', group: 'Deposit' },
  { id: 'deposit-failed', label: 'Deposit reverted', group: 'Deposit' },
  { id: 'note-pending', label: 'Note deposit still pending', group: 'Note' },
  { id: 'note-spent', label: 'Note already spent', group: 'Note' },
  { id: 'note-indeterminate', label: 'Note status unavailable', group: 'Note' },
  { id: 'proof-failed', label: 'Proof generation fails', group: 'Withdraw' },
  { id: 'sponsor-depleted', label: 'Sponsor out of funds', group: 'Withdraw' },
  { id: 'sponsor-offline', label: 'Sponsor unreachable', group: 'Withdraw' },
  { id: 'withdraw-unknown', label: 'Withdrawal outcome unknown', group: 'Withdraw' },
  { id: 'withdraw-failed', label: 'Withdrawal reverted', group: 'Withdraw' },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];

let current: ScenarioId = 'happy';
const listeners = new Set<(id: ScenarioId) => void>();

export const getScenario = (): ScenarioId => current;

export function setScenario(id: ScenarioId) {
  current = id;
  for (const l of listeners) l(id);
}

export function subscribeScenario(listener: (id: ScenarioId) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const scenarioIs = (id: ScenarioId) => current === id;
