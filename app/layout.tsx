import type { Metadata } from 'next'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Search Growth Engine',
  description: 'Find, prioritise and verify search growth opportunities across a domain portfolio',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="bg-background text-foreground antialiased">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </body>
    </html>
  )
}
