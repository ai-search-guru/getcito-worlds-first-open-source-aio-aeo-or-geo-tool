-- Reports (Simple Reports MVP).
-- One row per generated report. The report is IMMUTABLE: `payload` stores the
-- metric snapshot taken at generation time (insights summary, share of voice,
-- competitor comparison, citations overview) plus the AI executive summary
-- text, so the detail page renders from the saved payload with no live
-- queries. Writes happen through the authenticated client via Server Actions;
-- member policies below mirror site_audits/competitors (brand_id -> brands ->
-- profiles -> auth.uid()).

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  template text NOT NULL DEFAULT 'executive_summary',
  date_from timestamptz NOT NULL,
  date_to timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reports_brand_id_idx ON reports (brand_id, created_at DESC);

-- RLS: org-membership scoped, mirroring site_audits / competitors.
-- No UPDATE policy on purpose — reports are immutable snapshots.
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_member_select ON reports FOR SELECT
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY reports_member_insert ON reports FOR INSERT
  WITH CHECK (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );

CREATE POLICY reports_member_delete ON reports FOR DELETE
  USING (
    brand_id IN (
      SELECT b.id FROM brands b
      JOIN profiles p ON p.organization_id = b.organization_id
      WHERE p.id = auth.uid()
    )
  );
