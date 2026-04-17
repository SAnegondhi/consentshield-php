import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'ConsentShield',
  description: "India's DPDP compliance enforcement engine",
  // Pre-launch: these URLs are private. No search engine, no AI crawler.
  // See also app/src/app/robots.ts and next.config.ts X-Robots-Tag header.
  robots:
    'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
