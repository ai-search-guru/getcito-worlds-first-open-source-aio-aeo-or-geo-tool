-- Site Audit (VectorCite AEO/GEO rubric, MIT open standard).
-- One row per audit run + one row per evaluated signal.
-- Writes happen server-side via the service_role key; member policies below
-- keep direct authenticated-client reads org-scoped, mirroring competitors/topics.

CREATE TABLE IF NOT EXISTS site_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text,
  status text NOT NULL DEFAULT 'running', -- running | completed | failed
  total_score numeric,
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  signals_evaluated integer,
  signals_total integer,
  rubric_version text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS site_audits_brand_id_idx ON site_audits (brand_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_signal_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
  signal_key text NOT NULL,
  category text,
  status text NOT NULL, -- pass | warn | fail | na
  score numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_id, signal_key)
);

CREATE INDEX IF NOT EXISTS audit_signal_results_audit_id_idx ON audit_signal_results (audit_id);

-- RLS: org-membership scoped, mirroring content_opportunities / competitors.
ALTER TABLE site_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_signal_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY site_audits_member_select ON site_audits FOR SELECT
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_insert ON site_audits FOR INSERT
  WITH CHECK (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_update ON site_audits FOR UPDATE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY site_audits_member_delete ON site_audits FOR DELETE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

-- audit_signal_results inherit access through their parent audit's brand.
CREATE POLICY audit_signal_results_member_select ON audit_signal_results FOR SELECT
  USING (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY audit_signal_results_member_insert ON audit_signal_results FOR INSERT
  WITH CHECK (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY audit_signal_results_member_delete ON audit_signal_results FOR DELETE
  USING (
    audit_id IN (
      SELECT sa.id FROM site_audits sa
      JOIN brands b ON b.id = sa.brand_id
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );
