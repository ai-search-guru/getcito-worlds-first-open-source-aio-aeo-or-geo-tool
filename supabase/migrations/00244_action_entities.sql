-- AC-009: one count source for an action's prompts, pages, competitors…
--
-- One action showed 13 prompts in its title, 12 in its detail and 13 in a
-- task: the title and the tasks read the count saved in the payload when the
-- action was created, the detail, Copy all and the exports re-counted the
-- signals the nightly pass rewrites, and nothing changed when a prompt was
-- deleted or paused.
--
-- An action now keeps the list of what it is about, once, when it is created:
-- one action_entities row per prompt, page, competitor… (its payload's
-- targetEntity), written by a trigger on actions so every way an action is
-- made (the engine, Send to Action Center from content, prompts, mentions,
-- topics, traffic) keeps it the same way. A prompt deleted or paused, or a
-- competitor deleted, marks its rows removed (a prompt resumed is back), so
-- every place can say "12 prompts (1 removed since this action was
-- created)" and name the one removed.
--
-- Actions made before this keep what their payload still names: the first 50
-- of a bigger group (their count stays the payload's).

create table if not exists public.action_entities (
  action_id      uuid not null references public.actions(id) on delete cascade,
  -- The payload's targetEntity: prompts, pages, competitors, platforms…
  entity_type    text not null,
  -- The target's id (a prompt or competitor id, an address, a platform).
  entity_key     text not null,
  label          text,
  removed_at     timestamptz,
  removed_reason text
    constraint action_entities_removed_reason_check
      check (removed_reason is null or removed_reason in ('deleted', 'paused')),
  -- When the list was written: as the action was created, or by this
  -- migration's backfill for one made before (the nightly check, AC-009
  -- part 3, judges only lists kept at creation).
  kept_at        timestamptz not null default now(),
  primary key (action_id, entity_type, entity_key)
);

-- A prompt or competitor going: every action naming it, at once.
create index if not exists action_entities_entity_idx
  on public.action_entities (entity_type, entity_key)
  where entity_type in ('prompts', 'competitors');

comment on table public.action_entities is
  'AC-009: what an action is about (its payload''s targetEntity: prompts, pages, competitors…), kept once when the action is created; removed_at marks a prompt deleted or paused, or a competitor deleted, since. Every count of the action reads this list.';

alter table public.action_entities enable row level security;

drop policy if exists "action_entities: member select" on public.action_entities;
create policy "action_entities: member select" on public.action_entities
  for select using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

revoke all on table public.action_entities from anon, authenticated;
grant select on table public.action_entities to authenticated;
grant all on table public.action_entities to service_role;

-- An action's list from its payload: every key it lists (targetIds; a
-- person-sent action's promptIds or pages), else the targets it names
-- (`targets`, or the list under its targetEntity, as Improve's `platforms`),
-- with the names it gives. A prompt is named by its text where the payload
-- gives none. Empty lists name nothing: the next one down is read.
create or replace function public.snapshot_action_entities(
  p_action_id uuid,
  p_brand_id  uuid,
  p_payload   jsonb,
  -- Mark a prompt already deleted or paused, a competitor already deleted, as
  -- removed: for actions kept before 00244, whose list is written now. A new
  -- action's list is what it was made from: nothing is removed yet.
  p_mark_gone boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type  text := nullif(btrim(coalesce(p_payload->>'targetEntity', '')), '');
  v_keys  jsonb;
  v_named jsonb;
begin
  if v_type is null then
    return;
  end if;
  v_named := case
    when jsonb_typeof(p_payload->'targets') = 'array' then p_payload->'targets'
    when jsonb_typeof(p_payload->v_type) = 'array' then p_payload->v_type
    else '[]'::jsonb
  end;
  v_keys := case
    when jsonb_typeof(p_payload->'targetIds') = 'array'
     and jsonb_array_length(p_payload->'targetIds') > 0 then p_payload->'targetIds'
    when v_type = 'prompts' and jsonb_typeof(p_payload->'promptIds') = 'array'
     and jsonb_array_length(p_payload->'promptIds') > 0 then p_payload->'promptIds'
    when v_type = 'pages' and jsonb_typeof(p_payload->'pages') = 'array'
     and jsonb_array_length(p_payload->'pages') > 0 then p_payload->'pages'
  end;

  insert into public.action_entities (
    action_id, entity_type, entity_key, label, removed_at, removed_reason)
  select p_action_id, v_type, k.key,
         coalesce(n.label, pr.text),
         case when p_mark_gone then
           case
             when v_type = 'prompts' and k.uid is not null and pr.id is null then now()
             when v_type = 'prompts' and pr.id is not null and not coalesce(pr.is_active, true) then now()
             when v_type = 'competitors' and co.id is null then now()
           end
         end,
         case when p_mark_gone then
           case
             when v_type = 'prompts' and k.uid is not null and pr.id is null then 'deleted'
             when v_type = 'prompts' and pr.id is not null and not coalesce(pr.is_active, true) then 'paused'
             when v_type = 'competitors' and co.id is null then 'deleted'
           end
         end
  from (
    -- Listed keys when the payload has them, else the named targets' keys,
    -- once each, in the payload's order. A uuid key is cast here, never in a
    -- join: a key that is a prompt's text would fail the cast there.
    select key, min(ord) as ord,
           case when key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then key::uuid end as uid
    from (
      select btrim(x.value) as key, x.ord
      from jsonb_array_elements_text(coalesce(v_keys, '[]'::jsonb)) with ordinality as x(value, ord)
      union all
      select coalesce(t->>'id', t->>'label', case when jsonb_typeof(t) = 'string' then t #>> '{}' end),
             t_ord + 1000000
      from jsonb_array_elements(
             case when v_keys is null then v_named else '[]'::jsonb end
           ) with ordinality as y(t, t_ord)
    ) keys
    -- An object where an id belongs (old signals' { url, score }) is no key.
    where coalesce(key, '') <> '' and left(key, 1) not in ('{', '[')
    group by key
    order by min(ord)
    limit 1000
  ) k
  -- The names the payload gives.
  left join lateral (
    select case when jsonb_typeof(t) = 'string' then t #>> '{}' else nullif(t->>'label', '') end as label
    from jsonb_array_elements(v_named) as z(t)
    where coalesce(t->>'id', t->>'label', case when jsonb_typeof(t) = 'string' then t #>> '{}' end) = k.key
    limit 1
  ) n on true
  left join public.prompts pr
    on v_type = 'prompts' and pr.id = k.uid
  left join public.competitors co
    on v_type = 'competitors' and co.brand_id = p_brand_id
   and (co.id::text = k.key or co.name = k.key)
  on conflict do nothing;
end;
$$;

revoke all on function public.snapshot_action_entities(uuid, uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.actions_snapshot_entities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.snapshot_action_entities(new.id, new.brand_id, new.payload);
    -- The list is kept here now: the payload doesn't carry a thousand keys
    -- to every read of the action.
    if new.payload ? 'targetIds' then
      update public.actions set payload = payload - 'targetIds' where id = new.id;
    end if;
  exception when others then
    -- An action is never refused for its list: the nightly check finds one
    -- kept without it.
    raise warning 'action % kept no entities: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.actions_snapshot_entities() from public, anon, authenticated;

drop trigger if exists actions_snapshot_entities on public.actions;
create trigger actions_snapshot_entities
  after insert on public.actions
  for each row execute function public.actions_snapshot_entities();

-- A prompt deleted: removed from every action that names it.
create or replace function public.action_entities_prompts_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.action_entities e
  set removed_at = now(), removed_reason = 'deleted'
  from deleted_prompts d
  where e.entity_type = 'prompts'
    and e.entity_key = d.id::text
    and e.removed_reason is distinct from 'deleted';
  return null;
end;
$$;

revoke all on function public.action_entities_prompts_deleted() from public, anon, authenticated;

drop trigger if exists prompts_remove_from_actions on public.prompts;
create trigger prompts_remove_from_actions
  after delete on public.prompts
  referencing old table as deleted_prompts
  for each statement execute function public.action_entities_prompts_deleted();

-- A prompt paused is removed until it is resumed. (Transition tables can't
-- name columns, so every prompt update passes here; only an is_active change
-- touches a row.)
create or replace function public.action_entities_prompts_paused()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.action_entities e
  set removed_at = now(), removed_reason = 'paused'
  from changed_prompts n
  join earlier_prompts o on o.id = n.id
  where e.entity_type = 'prompts'
    and e.entity_key = n.id::text
    and coalesce(o.is_active, true) and not coalesce(n.is_active, true)
    and e.removed_at is null;

  update public.action_entities e
  set removed_at = null, removed_reason = null
  from changed_prompts n
  join earlier_prompts o on o.id = n.id
  where e.entity_type = 'prompts'
    and e.entity_key = n.id::text
    and not coalesce(o.is_active, true) and coalesce(n.is_active, true)
    and e.removed_reason = 'paused';
  return null;
end;
$$;

revoke all on function public.action_entities_prompts_paused() from public, anon, authenticated;

drop trigger if exists prompts_pause_in_actions on public.prompts;
create trigger prompts_pause_in_actions
  after update on public.prompts
  referencing old table as earlier_prompts new table as changed_prompts
  for each statement execute function public.action_entities_prompts_paused();

-- A competitor deleted: removed from its brand's actions, by id or by name
-- (older signals name competitors by name).
create or replace function public.action_entities_competitors_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.action_entities e
  set removed_at = now(), removed_reason = 'deleted'
  from deleted_competitors d
  join public.actions a on a.brand_id = d.brand_id
  where e.action_id = a.id
    and e.entity_type = 'competitors'
    and (e.entity_key = d.id::text or e.entity_key = d.name)
    and e.removed_at is null;
  return null;
end;
$$;

revoke all on function public.action_entities_competitors_deleted() from public, anon, authenticated;

drop trigger if exists competitors_remove_from_actions on public.competitors;
create trigger competitors_remove_from_actions
  after delete on public.competitors
  referencing old table as deleted_competitors
  for each statement execute function public.action_entities_competitors_deleted();

-- Each action's list in one read, for every place that shows a count: per
-- entity type, how many it was made with, how many are removed since, the names
-- of the removed (up to 20, for the hover) and their keys (to leave them out
-- of a list). Read through the member's policy: only their brands' actions
-- answer.
create or replace function public.action_entity_counts(p_action_ids uuid[])
returns table (
  action_id      uuid,
  entity_type    text,
  total          integer,
  removed        integer,
  removed_labels text[],
  removed_keys   text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.action_id,
         e.entity_type,
         count(*)::integer,
         count(*) filter (where e.removed_at is not null)::integer,
         (array_agg(coalesce(e.label, e.entity_key) order by e.removed_at, e.entity_key)
            filter (where e.removed_at is not null))[1:20],
         array_agg(e.entity_key order by e.removed_at, e.entity_key)
            filter (where e.removed_at is not null)
  from public.action_entities e
  where e.action_id = any (p_action_ids[1:500])
  group by e.action_id, e.entity_type;
$$;

revoke execute on function public.action_entity_counts(uuid[]) from public, anon;
grant execute on function public.action_entity_counts(uuid[]) to authenticated, service_role;

-- The actions made before: their list from what their payload still names.
-- A topic opportunity counts its suggestions (targets), not the tracked
-- prompts it measures (promptIds). An action that names nothing a list can
-- hold keeps none; the web then shows its saved count (part 2).
select public.snapshot_action_entities(
  a.id,
  a.brand_id,
  case when a.kind = 'topic_opportunity' then a.payload - 'promptIds' else a.payload end,
  true)
from public.actions a
where a.deleted_at is null;
