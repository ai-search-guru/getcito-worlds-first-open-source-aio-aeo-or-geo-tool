'use client';

import { useParams } from 'next/navigation';
import { OpportunityDetail } from '@/components/content/OpportunityDetail';

export default function ContentDetailPage() {
  const params = useParams();
  return <OpportunityDetail id={params.id as string} />;
}
