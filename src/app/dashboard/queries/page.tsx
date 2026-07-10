'use client'
import React from 'react';
import dynamic from 'next/dynamic';

// Dynamically import the queries content with no SSR
const QueriesContent = dynamic(
  () => import('./queries-content'),
  { 
    ssr: false,
    loading: () => <div className="p-6">Loading queries...</div>
  }
);

export default function QueriesPage(): React.ReactElement {
  return <QueriesContent />;
} 