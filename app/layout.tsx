import type { Metadata, Viewport } from 'next'
import { Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Providers from './providers'

// Type: Helvetica Neue Bold first (a system font — free, instant, no download),
// with Inter downloaded as the stand-in for everyone who doesn't have it, which
// is most of Windows and Android. Inter is a neo-grotesque cut for screens, so
// a visitor without Helvetica Neue lands somewhere very close instead of on
// Arial. Variable font: every weight comes in one file.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// The mono face carries the numbers, addresses and status labels.
// 600/700 are loaded because the page's default weight is now bold, and without
// a real bold cut the browser would fake one by smearing the 400 weight.
const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'somoco — predictions on intuition',
  description:
    'Type a prediction in plain English. Somoco parses it with AI and writes it permanently to the Intuition protocol, where anyone can stake $TRUST for or against it.',
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // The font variables go on <html>, not <body>: globals.css builds
    // --font-sans out of --font-inter in the :root block, and a var() inside a
    // custom property is resolved on the element that declares it. Defined one
    // level lower, on <body>, the reference would resolve to nothing.
    <html lang="en" className={`${inter.variable} ${ibmMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
