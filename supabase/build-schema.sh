#!/usr/bin/env bash
#
# Regenerates supabase/schema.sql by concatenating every migration in
# supabase/migrations/ in order.
#
# schema.sql is a one-paste convenience for FRESH self-host installs via the
# Supabase SQL Editor — it is NOT the migration history. Existing installs (and
# the managed cloud) upgrade by applying new numbered migrations / `db push`;
# never squash or rewrite the files under supabase/migrations/.
#
# Run this whenever you add a migration:
#     bash supabase/build-schema.sh
#
# CI runs it and fails if the committed schema.sql is out of date.
set -euo pipefail

cd "$(dirname "$0")"

out="schema.sql"

{
  echo "-- ============================================================================"
  echo "-- getcito — consolidated database schema"
  echo "--"
  echo "-- GENERATED FILE — do not edit by hand. This is every migration in"
  echo "-- supabase/migrations/ concatenated in order, so a fresh install can be"
  echo "-- created by pasting this one file into the Supabase SQL Editor."
  echo "--"
  echo "-- It is NOT the migration history: existing installs upgrade by applying new"
  echo "-- numbered migrations (or \`supabase db push\`)."
  echo "--"
  echo "-- Regenerate after adding a migration:  bash supabase/build-schema.sh"
  echo "-- ============================================================================"
  echo ""

  for f in migrations/*.sql; do
    echo "-- ─────────────────────────────────────────────────────────────────────────"
    echo "-- $f"
    echo "-- ─────────────────────────────────────────────────────────────────────────"
    cat "$f"
    echo ""
  done
} >"$out"

count=$(find migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
echo "Wrote $out from $count migration file(s)."
