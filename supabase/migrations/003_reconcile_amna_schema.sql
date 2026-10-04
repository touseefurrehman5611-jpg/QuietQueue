-- 003: bring a database that was built from Amna's old supabase-schema.sql
--     up to what the code actually needs.
--
-- WHY THIS FILE EXISTS
-- Amna's original README told people to run a single `supabase-schema.sql` at
-- the repo root. If anyone followed that, their database is missing things this
-- code reads on every request:
--
--   queues.speed_multiplier    -> rowToQueue reads it; without it every wait
--                                 estimate becomes NaN minutes
--   visitors.alerted           -> rowToVisitor reads it; without it no alert can
--                                 ever fire
--   unique (queue_id, ticket_no)
--                              -> createVisitor reads the max ticket and then
--                                 inserts, relying on this to catch two people
--                                 arriving at once. Without it, concurrent joins
--                                 silently get the same number instead of
--                                 retrying.
--
-- Her policies were also `for all using (true)`, which lets the public anon key
-- UPDATE and DELETE every row. The three drops below put back the read-only
-- policies from 001_init.sql.
--
-- RUNNING IT IS SAFE either way. Every statement is `if exists` / `if not
-- exists`, so it is a no-op on a database built from 001 + 002, and it is
-- re-pasteable. If you already ran 001 and 002 you do not need it at all.
--
-- Phone numbers are not mentioned here: 002_phone_split.sql already moves that
-- column, and both of those files are idempotent, so running 002 after her
-- schema closes the same hole.

-- ---- the columns the routes read ----

alter table public.queues
  add column if not exists speed_multiplier real not null default 1.0;

alter table public.visitors
  add column if not exists alerted boolean not null default false;

-- The range is checked in validate.ts as well. Having it here too means a
-- direct SQL write cannot put the desk into a state no estimate survives.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'queues_speed_multiplier_range'
  ) then
    alter table public.queues
      add constraint queues_speed_multiplier_range
      check (speed_multiplier between 0.25 and 4);
  end if;
end $$;

-- ---- the unique rule createVisitor's retry loop depends on ----

-- Adding a constraint to a table that already holds duplicates fails, so give
-- the repeats new numbers first. Only reachable on a database built from her
-- schema, where nothing stopped two joins taking the same ticket.
update public.visitors v
set ticket_no = (
  select count(*) from public.visitors inner_v
  where inner_v.queue_id = v.queue_id
    and inner_v.ticket_no <= v.ticket_no
)
where exists (
  select 1 from public.visitors dup
  where dup.queue_id = v.queue_id and dup.ticket_no = v.ticket_no and dup.id <> v.id
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'visitors_queue_ticket_unique'
  ) then
    alter table public.visitors
      add constraint visitors_queue_ticket_unique unique (queue_id, ticket_no);
  end if;
end $$;

-- ---- put the read-only policies back ----

drop policy if exists "Allow all for queues" on public.queues;
drop policy if exists "Allow all for visitors" on public.visitors;
drop policy if exists "Allow all for service_events" on public.service_events;

-- Realtime needs the anon key to be able to read `visitors`, and nothing more.
-- Every write in this app goes through the service role, which bypasses RLS.
drop policy if exists "anyone can read queues" on public.queues;
drop policy if exists "anyone can read visitors" on public.visitors;
drop policy if exists "anyone can read service events" on public.service_events;

create policy "anyone can read queues"
  on public.queues for select to anon, authenticated using (true);

create policy "anyone can read visitors"
  on public.visitors for select to anon, authenticated using (true);

create policy "anyone can read service events"
  on public.service_events for select to anon, authenticated using (true);