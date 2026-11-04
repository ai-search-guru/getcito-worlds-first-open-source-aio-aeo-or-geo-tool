-- ============================================================================
-- 00472: the free AI visibility report card's requests and cards
-- ============================================================================
-- People ask for a free report card on www.getcito.com's form (Customer
-- priorities §5). The API's public endpoint (POST /public/report-card)
-- keeps each request, and the card it gets: 25 questions asked in ChatGPT,
-- Gemini, Google AI Overviews and Google AI Mode in the person's target
-- country, what the answers said, and the PDF's figures. The PDF itself is
-- drawn again from those figures whenever it is sent.
--
--   * report_cards: one per company (its work e-mail's domain) every 30
--     days; a repeat request is answered with the card already made, at no
--     cost. A card is queued, then running, then ready or failed. One
--     queued past the day's cap waits (run_after) for the next morning.
--     Its cost in dollars is kept, for the daily and monthly caps.
--   * report_card_requests: every request the form sent, with what the
--     person gave (name, title, work e-mail, LinkedIn, company, country,
--     size, optional industry and deal value), their consents, how it was
--     answered and what became of the e-mail. No IP address is kept: the
--     hourly limit per address is held in the API's memory.
--
-- Written and read by the API's service-role client only: RLS on, no
-- policies, and the default grants to anon and authenticated revoked (as
-- 00222 does), since the requests hold people's names and e-mails. The
-- requests are deleted after 12 months, by the API's daily sweep.

create table if not exists public.report_cards (
  id uuid primary key default gen_random_uuid(),
  -- The company: its work e-mail's domain, lower case. One card per domain every 30 days.
  domain text not null check (
    char_length(domain) between 3 and 253 and domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  -- The site measured: the website given, without "www.", the domain or a subdomain of it.
  site text not null check (
    char_length(site) between 3 and 253 and site = lower(site) and site ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  company_name text not null check (char_length(company_name) between 1 and 100),
  -- The target country (ISO 3166-1 alpha-2) and its main language (ISO 639-1).
  country text not null check (country ~ '^[A-Z]{2}$'),
  language text not null check (language ~ '^[a-z]{2}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed')),
  -- When it may start: now, or the next morning past the day's cap.
  run_after timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10),
  -- What the PDF draws (frontend/src/lib/report-card/payload.ts), once ready.
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'),
  -- The questions as asked: text, English, keyword, and each engine's answer in short.
  questions jsonb check (questions is null or jsonb_typeof(questions) = 'array'),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  -- Why it failed, in plain words.
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  check ((status = 'ready') = (payload is not null)),
  check (status not in ('ready', 'failed') or finished_at is not null)
);

-- One card being made per company at a time: two requests at once share it.
create unique index if not exists report_cards_one_pending_idx
  on public.report_cards (domain)
  where status in ('queued', 'running');

-- The company's last card (the 30-day rule), the queue, and the day's and month's counts.
create index if not exists report_cards_domain_created_idx
  on public.report_cards (domain, created_at desc);
create index if not exists report_cards_queue_idx
  on public.report_cards (run_after)
  where status in ('queued', 'running');
create index if not exists report_cards_started_idx
  on public.report_cards (started_at)
  where started_at is not null;

alter table public.report_cards enable row level security;
revoke all on public.report_cards from anon, authenticated;

comment on table public.report_cards is
  'Free AI visibility report cards (00472; Customer priorities §5): one per site every 30 days, its figures and cost. Server-only.';

create table if not exists public.report_card_requests (
  id uuid primary key default gen_random_uuid(),
  report_card_id uuid references public.report_cards (id) on delete set null,
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name text not null check (char_length(last_name) between 1 and 60),
  title text not null check (char_length(title) between 1 and 100),
  email text not null check (
    char_length(email) <= 254 and email = lower(email) and email ~ '^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  linkedin_url text not null check (char_length(linkedin_url) <= 300),
  company_name text not null check (char_length(company_name) between 1 and 100),
  -- The website as typed, and the domain measured.
  website text not null check (char_length(website) <= 300),
  domain text not null check (char_length(domain) between 3 and 253),
  country text not null check (country ~ '^[A-Z]{2}$'),
  company_size text not null
    check (company_size in ('1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+')),
  industry text check (char_length(industry) <= 60),
  deal_value numeric(14, 2) check (deal_value > 0),
  deal_currency text check (deal_currency ~ '^[A-Z]{3}$'),
  consent_privacy boolean not null check (consent_privacy),
  consent_own_site boolean not null check (consent_own_site),
  consent_marketing boolean not null default false,
  -- The form's page and campaign, as sent.
  page text check (char_length(page) <= 100),
  utm jsonb check (utm is null or (jsonb_typeof(utm) = 'object' and octet_length(utm::text) <= 1000)),
  -- How it was answered: a new card queued, the card already made sent
  -- again, or queued for tomorrow past the day's cap.
  outcome text not null check (outcome in ('queued', 'resent', 'daily_cap')),
  -- What became of the e-mail: sent, refused, unknown or skipped (backend/src/lib/email.js).
  email_status text check (email_status in ('sent', 'refused', 'unknown', 'skipped')),
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((deal_value is null) = (deal_currency is null))
);

create index if not exists report_card_requests_card_idx
  on public.report_card_requests (report_card_id);
create index if not exists report_card_requests_created_idx
  on public.report_card_requests (created_at);
-- A person's requests, for a deletion request.
create index if not exists report_card_requests_email_idx
  on public.report_card_requests (email);

alter table public.report_card_requests enable row level security;
revoke all on public.report_card_requests from anon, authenticated;

comment on table public.report_card_requests is
  'Every free report card request from the www.getcito.com form (00472): what the person gave, their consents and how it was answered. Server-only; deleted after 12 months.';
