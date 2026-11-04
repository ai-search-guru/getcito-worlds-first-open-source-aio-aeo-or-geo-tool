import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * One action, by its id: the Actions page with its drawer open
 * (`?action=`), on the action's own brand (`&brand=`) and with no filter, so
 * the drawer opens whatever brand or filter was on before. Chat's Open in
 * Actions links here (CHAT-09 item 19): a link Chat shows is a path in the
 * app, without a query. An action the person can't read opens the list.
 */
export default async function ActionRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('actions').select('brand_id').eq('id', id).maybeSingle();
  const brandId = (data?.brand_id as string | undefined) ?? null;
  if (!brandId) redirect('/dashboard/action-center/actions');
  redirect(
    `/dashboard/action-center/actions?action=${encodeURIComponent(id)}&brand=${encodeURIComponent(brandId)}`,
  );
}
