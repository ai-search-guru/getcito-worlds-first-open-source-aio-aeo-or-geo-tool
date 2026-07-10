'use client'
import React from 'react';
import AuthDebugger from '@/components/test/AuthDebugger';

export default function TestAuthPage() {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold text-center mb-8">Authentication Test Page</h1>
        <AuthDebugger />
      </div>
    </div>
  );
} 