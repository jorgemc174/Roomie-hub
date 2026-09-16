import type { NextConfig } from 'next';
const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  poweredByHeader: false,
};
export default config;
