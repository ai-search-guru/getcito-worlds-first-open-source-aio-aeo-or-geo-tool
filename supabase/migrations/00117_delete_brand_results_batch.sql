-- Deleting a brand in batches.
--
-- A brand delete cascades to every answer it ever received, and from each
-- answer to its citation rows and shopping cards. A brand with 15,000 answers
-- carries well over 100,000 citation rows. Run as one statement under the
-- authenticated role's 8-second statement timeout, the delete was cancelled
-- every time, and the brand stayed.
--
-- The server now deletes a brand's answers in batches with this function,
-- each batch a short statement of its own, and deletes the brand row once
-- they are gone.

create or replace function public.delete_brand_results_batch(
  p_brand_id uuid,
  p_limit integer default 2000
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  deleted integer;
begin
  delete from prompt_results
   where id in (
     select id from prompt_results where brand_id = p_brand_id limit p_limit
   );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.delete_brand_results_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_brand_results_batch(uuid, integer) to service_role;
