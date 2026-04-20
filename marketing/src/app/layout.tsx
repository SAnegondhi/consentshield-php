import type { Metadata } from 'next'
import { DM_Sans, DM_Mono } from 'next/font/google'
import './globals.css'

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
  title: 'ConsentShield — India\'s DPDP Compliance Enforcement Engine',
  description:
    'ConsentShield turns DPDP Act consent into enforceable, auditable compliance events. Stateless oracle — process, deliver, delete.',
  metadataBase: new URL('https://consentshield.in'),
  openGraph: {
    title: 'ConsentShield',
    description:
      'DPDP compliance enforcement engine for India. Stateless, auditable, compliant.',
    url: 'https://consentshield.in',
    siteName: 'ConsentShield',
    locale: 'en_IN',
    type: 'website',
  },
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
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"
        />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  )
}
