import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { SHIPPED_DESCRIPTION } from '@/config/brand';

/**
 * The wallet is the root now, so it takes the brand title from the layout
 * rather than naming a spec: this is the address a judge or a search result
 * lands on first.
 */
export const metadata: Metadata = {
  description: SHIPPED_DESCRIPTION,
};

export default function Page() {
  return <AppShell />;
}
