-- ============================================================================
-- 00385: "Your first results are ready", e-mailed once per person
-- ============================================================================
-- A new customer's first tracking run takes 30 to 65 minutes, and most leave
-- the app meanwhile. When a brand's first full run stamps, the API e-mails
-- the organization's members that its results are in
-- (backend/src/lib/firstResultsEmail.js).
--
--   * profiles.first_results_emailed_at: when the person was sent it. The
--     API claims the members still without one in a single update before it
--     sends, so two brands' first runs finishing at once never send it
--     twice, and a later brand's first run doesn't send it again. A send
--     Resend refused (or one skipped where e-mail isn't set up) gives the
--     claim back.

alter table public.profiles
  add column if not exists first_results_emailed_at timestamptz;

comment on column public.profiles.first_results_emailed_at is
  'When "Your first results are ready" was e-mailed to the person, once, after a brand''s first full tracking run stamped. Null: never sent.';
