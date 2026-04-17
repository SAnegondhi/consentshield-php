import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  )
}
