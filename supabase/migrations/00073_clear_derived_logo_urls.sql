-- Migration: 00073_clear_derived_logo_urls
--
-- Context (issue #759):
--   logo_url was written at brand creation and on every primary-domain change
--   using Google's s2/favicons service. The new BrandAvatar component derives
--   the favicon at render time instead (Google → /favicon.ico → initials), so
--   logo_url should only hold a URL the user explicitly chose.
--
-- Effect:
--   Clears the derived Google favicon URLs so existing brands reach the
--   fallback chain. The single brand with logo_url = null already did.
--   Manual URLs (2 rows in production at time of writing) are unaffected
--   because they do not match the s2/favicons pattern.
--
-- Safe to re-run: WHERE clause is idempotent.

update brands
set logo_url = null
where logo_url like '%s2/favicons%';
