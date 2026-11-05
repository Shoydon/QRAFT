import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { WORDMARK, SHIPPED_DESCRIPTION } from '@/config/brand';

export const metadata: Metadata = {
  title: `Deposit and withdraw — ${WORDMARK}`,
  description: SHIPPED_DESCRIPTION,
};

export default function Page() {
  return <AppShell />;
}
