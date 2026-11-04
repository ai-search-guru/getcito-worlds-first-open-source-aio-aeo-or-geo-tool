-- 00016_enable_rls_exposed_tables.sql
--
-- Close a direct-REST data exposure: four tables have shipped since 00001 with
-- Row Level Security DISABLED and GRANT ALL to the `authenticated` role and no
-- policies. With RLS off, anyone holding the public anon key can read or write
-- EVERY organization's rows in these tables straight through PostgREST,
-- bypassing the application entirely:
--
--   public.competitors, public.topics, public.prompt_volumes, public.jobs
--
-- Why enabling RLS here is safe (verified against the current code + schema):
--
--   * All server-side / worker access goes through the service_role key
--     (backend/src/config/supabase.js, frontend/src/lib/supabase/admin.ts), which
--     bypasses RLS regardless of policies — unaffected.
--
--   * No SQL function references any of these four tables, so no SECURITY
--     INVOKER RPC can be starved by enabling RLS (confirmed: zero matches in
--     pg_get_functiondef across all public functions).
--
--   * jobs and prompt_volumes are NEVER read through the cookie-based
--     authenticated client — only via service_role (Express job manager, and
--     frontend/src/lib/mcp/data.ts which uses supabaseAdmin). So enabling RLS with
--     NO policy denies the authenticated/anon REST surface outright while the
--     service_role path keeps working.
--
--   * competitors and topics ARE read and written by Server Actions through the
--     authenticated client (frontend/src/lib/actions/competitor.ts, topic.ts,
--     citations.ts, prompt.ts, tracking.ts). They get org-membership-scoped
--     policies that mirror the existing "content_opportunities: member select"
--     pattern (brand_id -> brands -> profiles -> auth.uid()).
--
-- Policy scope: member-level (any member of the owning org) for all of
-- SELECT/INSERT/UPDATE/DELETE. This preserves today's in-org behavior — with
-- RLS off, any authenticated org member could already CRUD these rows — while
-- blocking the cross-org access that was previously possible. Tightening writes
-- to admin/manager (as brands/content_opportunities do) is a separate decision.

-- ---------------------------------------------------------------------------
-- Server-only tables: enable RLS, no policy (service_role bypasses).
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_volumes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- competitors: org-membership-scoped policies (brand_id -> brands -> profiles).
-- ---------------------------------------------------------------------------
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitors: member select" ON public.competitors
  FOR SELECT USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member insert" ON public.competitors
  FOR INSERT WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member update" ON public.competitors
  FOR UPDATE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "competitors: member delete" ON public.competitors
  FOR DELETE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- topics: org-membership-scoped policies (brand_id -> brands -> profiles).
-- ---------------------------------------------------------------------------
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topics: member select" ON public.topics
  FOR SELECT USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member insert" ON public.topics
  FOR INSERT WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member update" ON public.topics
  FOR UPDATE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "topics: member delete" ON public.topics
  FOR DELETE USING (
    brand_id IN (
      SELECT b.id
      FROM public.brands b
      JOIN public.profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );
