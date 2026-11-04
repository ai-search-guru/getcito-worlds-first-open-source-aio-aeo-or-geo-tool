-- Integration connections — Settings → Integrations surface (#577).
--
-- One row per (organization, provider). Only google-search-console for now;
-- the table is the generic surface future integrations plug into. OAuth
-- tokens never touch this table — Composio stores them; we keep only the
-- Composio account/entity ids and the connection status.
--
-- The server (service role) writes; org members read so the card state is
-- visible to teammates. Admin/manager write policies exist for completeness
-- even though the normal write path is the service role.

CREATE TABLE public.integration_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider text NOT NULL,
    composio_account_id text,
    composio_entity_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    connected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, provider)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integration_connections: member select" ON public.integration_connections
    FOR SELECT USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p WHERE p.id = auth.uid()
        )
    );

CREATE POLICY "integration_connections: admin write" ON public.integration_connections
    FOR ALL USING (
        organization_id IN (
            SELECT p.organization_id FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role = ANY (ARRAY['admin'::public.user_role, 'manager'::public.user_role])
        )
    );

GRANT SELECT ON public.integration_connections TO authenticated;
