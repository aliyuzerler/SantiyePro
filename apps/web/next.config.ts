import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace'teki TS kaynaklı paketler Next.js tarafından derlenir
  transpilePackages: ['@santiyepro/contracts'],
};

export default nextConfig;
