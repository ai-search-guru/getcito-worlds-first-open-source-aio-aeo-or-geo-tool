'use client'
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { BarChart3 } from 'lucide-react';

export default function AnalyticsPage(): React.ReactElement {
  const router = useRouter();

  // Redirect to overview page where analytics are now located
  React.useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Analytics Moved</h3>
          <p className="text-muted-foreground mb-4">
            Analytics have been moved to the Overview page for better accessibility.
          </p>
          <Link href="/dashboard" className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors">
            Go to Overview
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
} 