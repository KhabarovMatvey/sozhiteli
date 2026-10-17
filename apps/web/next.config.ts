import path from 'node:path';

import type { NextConfig } from 'next';

// Docker-образ (apps/web/Dockerfile) собирается автономно: Next.js кладёт в
// .next/standalone сервер и только нужные ему node_modules. Для `npm run
// build && npm run start` режим не включается: next start его не поддерживает.
const standalone =
  process.env.NEXT_OUTPUT_STANDALONE === '1'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') }
    : {};

const nextConfig: NextConfig = {
  ...standalone,
  reactStrictMode: true,
  poweredByHeader: false,
  // Пакет клиента API поставляется исходниками TypeScript, без отдельной сборки.
  transpilePackages: ['@sozhiteli/api-client'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
