-- ============================================================================
-- 00272: Content images — upload an image instead of pasting its address
-- ============================================================================
-- Most people have the screenshot or photo on their computer, not at an
-- address. The Content Editor's image dialogs and an author's photo upload
-- it here: a public bucket (the page and the CMS show it by its address),
-- JPEG, PNG, WebP or GIF, 5 MB at most.
--
-- Each organization's images go under its own folder ({organization_id}/
-- {id}.{ext}). Members have no policy here: the app gives a one-time
-- upload address for a name it makes, and says who may upload and how
-- much (on the managed cloud, an organization with an active or trialing
-- subscription, a number a day; only the app knows a cloud from a
-- self-host). Nothing is overwritten or deleted from the app; anyone with
-- an image's address can see it, as any image on a published page.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-images',
  'content-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
-- Run again, it leaves the bucket as an admin may have set it.
on conflict (id) do nothing;

-- Each one-time upload address the app gives, on the managed cloud: the
-- day's cap counts them, not the files arrived (an address may be used
-- later). Only the service role reads and writes it.
create table if not exists public.content_image_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

create index if not exists content_image_uploads_org_created_idx
  on public.content_image_uploads (organization_id, created_at);

alter table public.content_image_uploads enable row level security;

comment on table public.content_image_uploads is
  'Content images (00272): each one-time upload address given on the managed cloud, for the daily cap. Service role only.';

notify pgrst, 'reload schema';
