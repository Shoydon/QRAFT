import type { Metadata } from 'next';
import { PqApp } from '@/components/PqApp';

export const metadata: Metadata = {
  title: 'Post-quantum proofs — QRAFT',
  description: 'Browser-created hiding STARK proofs with staged verification on the chain-1337 alternative mempool.',
};

export default function Page() {
  return <PqApp />;
}
