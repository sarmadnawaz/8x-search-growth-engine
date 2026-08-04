import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Search Growth Engine',
  description: 'Find, prioritise and verify search growth opportunities across a domain portfolio',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
