-- Bring-your-own-key for the in-product AI agent on cloud.
--
-- Cloud customers paste their own Anthropic API key in Settings → Agent;
-- the agent's chat endpoint reads it back at request time, decrypts it,
-- and uses it to drive `streamText`. Without a key the feature stays
-- locked regardless of plan.
--
-- The key itself lives in `anthropic_api_key_encrypted` as the JSON
-- envelope returned by the app-level AES-256-GCM helper
-- (frontend/src/lib/agent/keyEncryption.ts). The app's master key
-- (GETCITO_ENCRYPTION_KEY) is the only thing that can decrypt it —
-- Postgres + Supabase admins see ciphertext only.
--
-- `last4` is mirrored in plaintext so the Settings UI can show
-- "sk-…abcd" without round-tripping decrypt. `set_at` / `set_by` give us
-- an audit trail for support cases ("when did the key change?").

alter table public.organizations
  add column if not exists anthropic_api_key_encrypted text,
  add column if not exists anthropic_api_key_last4 text,
  add column if not exists anthropic_api_key_set_at timestamptz,
  add column if not exists anthropic_api_key_set_by uuid references public.profiles(id) on delete set null;

comment on column public.organizations.anthropic_api_key_encrypted is
  'AES-256-GCM ciphertext (JSON envelope) of the org-level Anthropic API key. Null = no key configured.';
comment on column public.organizations.anthropic_api_key_last4 is
  'Last 4 chars of the plaintext key. Display-only; safe to expose to org members.';
comment on column public.organizations.anthropic_api_key_set_at is
  'When the current key was last saved.';
comment on column public.organizations.anthropic_api_key_set_by is
  'Profile of the org member who saved the current key. Set null on profile delete to preserve audit trail.';
