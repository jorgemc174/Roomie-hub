import type { NextConfig } from 'next';
const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  poweredByHeader: false,
};
export default config;
