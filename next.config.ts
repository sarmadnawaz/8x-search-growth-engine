import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output is for the container image. Vercel builds Next.js
  // itself, so it is only set outside Vercel.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  serverExternalPackages: ['@prisma/client', 'cheerio'],
}

export default nextConfig
