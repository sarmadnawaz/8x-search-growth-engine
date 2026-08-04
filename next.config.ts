import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // required by the runtime stage of the Dockerfile
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'cheerio'],
}

export default nextConfig
