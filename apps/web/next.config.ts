import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace'teki TS kaynaklı paketler Next.js tarafından derlenir
  transpilePackages: ['@santiyepro/contracts'],
  // Sandbox önizleme proxy'si /panel önekiyle servis eder; üretimde boş bırakılabilir
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
};

export default nextConfig;
