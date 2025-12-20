"use client"

import React from 'react'
import { AuthContextProvider } from '@/context/AuthContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { BrandContextProvider } from '@/context/BrandContext'
import { ToastProvider } from '@/context/ToastContext'
import { QueryProvider } from '@/providers/QueryProvider'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <AuthContextProvider>
          <BrandContextProvider>
            <ToastProvider>{children}</ToastProvider>
          </BrandContextProvider>
        </AuthContextProvider>
      </ThemeProvider>
    </QueryProvider>
  )
}
