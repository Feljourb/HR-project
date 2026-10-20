import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import './globals.css'

const instrumentSans = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Employee Self-Service Portal | SBD',
  description: 'Silent Believers Distribution employee self-service portal.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${plexMono.variable}`}>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
