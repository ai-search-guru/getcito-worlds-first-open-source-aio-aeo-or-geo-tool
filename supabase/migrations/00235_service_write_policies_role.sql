-- ============================================================================
-- 00235: the service-role write policies apply to service_role
-- ============================================================================
-- These insert and delete policies were written for the server's writes but
-- created without a role, so they applied to every role. Only the server
-- (service_role) writes these tables, and service_role bypasses row security
-- anyway; scoping the policies to it leaves the server's writes as they are.

alter policy "Service role can insert prompt results" on public.prompt_results to service_role;
alter policy "Service role can delete prompt results" on public.prompt_results to service_role;

alter policy "Service role can insert citations" on public.prompt_result_citations to service_role;
alter policy "Service role can delete citations" on public.prompt_result_citations to service_role;

alter policy "Service role can insert shopping cards" on public.prompt_result_shopping_cards to service_role;
alter policy "Service role can delete shopping cards" on public.prompt_result_shopping_cards to service_role;

alter policy "Service role can insert signals" on public.signals to service_role;
alter policy "Service role can delete signals" on public.signals to service_role;

alter policy "Service role can insert traffic logs" on public.ai_traffic_logs to service_role;

alter policy "Service role can insert citation urls" on public.citation_urls to service_role;
