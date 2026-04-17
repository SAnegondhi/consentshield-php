import type { Metadata } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

// Wireframe spec (docs/admin/design/consentshield-admin-screens.html :root) uses
// DM Sans for body text and DM Mono for monospace. Next/font loads and hosts
// them locally (subsetting + preload); CSS vars --font-dm-sans / --font-dm-mono
// are consumed by @theme in globals.css so Tailwind's font-sans / font-mono
// utilities resolve correctly.
const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

const dmMono = DM_Mono({
  variable: '--font-dm-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ConsentShield Admin',
  description: 'ConsentShield operator console.',
  // Admin console is always private — never indexed, never ingested by AI.
  // See also admin/src/app/robots.ts and next.config.ts X-Robots-Tag header.
  robots:
    'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  )
}
