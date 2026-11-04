import { notFound } from 'next/navigation';
import { ImpactReportView } from '@/components/reports/ImpactReport';
import { chatPageOpen } from '../../chat/_chatPageAccess';

/**
 * Reports › "What GetCito did for you" (CHAT-22 feature 2 item 5, mockup
 * signature #f-impact): the month's shipped changes on the brand on screen,
 * measured against untouched similar prompts. Only with the new Chat on for
 * the workspace (CHAT_AGENTIC), which is when the ledger is kept.
 */
export default async function ImpactReportPage() {
  if (!(await chatPageOpen())) notFound();
  return <ImpactReportView />;
}
