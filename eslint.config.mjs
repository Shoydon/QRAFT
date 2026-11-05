import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', '.local/**', 'protocol/build/**', 'packages/**', 'public/pq-v5/**', 'public/proving/snarkjs.min.js'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
