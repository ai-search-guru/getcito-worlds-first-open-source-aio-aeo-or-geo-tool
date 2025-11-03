'use client'
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AddBrandRedirect(): React.ReactElement {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/add-brand/step-1');
  }, [router]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-foreground text-lg">Redirecting to brand setup...</div>
    </div>
  );
} 