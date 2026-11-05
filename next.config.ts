import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingExcludes: {
    '/*': ['./.local/**/*', './.env*', './packages/**/target/**/*'],
  },
  // The anon-rpc harness boots a null-origin sandboxed iframe and reads its
  // worker bundle from untrusted resolvers, so the page itself must stay
  // conservative: no inline scripts of our own, no framing by third parties.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
