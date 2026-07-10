import React from 'react';
import { AuthContextProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { BrandContextProvider } from '@/context/BrandContext';
import { ToastProvider } from '@/context/ToastContext';
import { QueryProvider } from '@/providers/QueryProvider';
import { Inter } from 'next/font/google';
import './globals.css';

// Load the Inter font with 'latin' subset
const inter = Inter( { subsets: [ 'latin' ] } );

// Metadata for the application
export const metadata = {
  title: 'GetCito Dashboard',
  description: 'Intelligent brand analysis and query optimization platform',
};

// Root layout component for the application
export default function RootLayout( { children }: { children: React.ReactNode } ): React.ReactElement {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        The <head /> component will contain the components returned by the nearest parent
        head.js. It can be used to define the document head for SEO, metadata, and other purposes.
        Learn more at https://beta.nextjs.org/docs/api-reference/file-conventions/head
      */}
      <head />
      <body className={`${inter.className} antialiased`} suppressHydrationWarning>
        <QueryProvider>
          <ThemeProvider>
            <AuthContextProvider>
              <BrandContextProvider>
                <ToastProvider>
                {children}
                </ToastProvider>
              </BrandContextProvider>
            </AuthContextProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
