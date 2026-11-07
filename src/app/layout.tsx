import type { Metadata, Viewport } from 'next';
import { Inter_Tight, IBM_Plex_Mono } from 'next/font/google';
import { WORDMARK, TAGLINE, SHIPPED_DESCRIPTION } from '@/config/brand';
import './globals.css';

const sans = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter-tight',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: `${WORDMARK} — ${TAGLINE}`, template: `%s` },
  // The description states what the build actually does, not what the name
  // describes: see SHIPPED_DESCRIPTION.
  description: `${SHIPPED_DESCRIPTION}. Deposit ETH, send exact private payments, and withdraw to a public address with proofs generated on your device.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#faf9f7',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
