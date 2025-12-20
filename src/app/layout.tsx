import React from 'react'
import { Inter } from 'next/font/google'
import './globals.css'
import Providers from '@/app/providers'

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  fallback: ['system-ui', 'arial'],
})

export const metadata = {
  title: 'GetCito Dashboard',
  description: 'Intelligent brand analysis and query optimization platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
