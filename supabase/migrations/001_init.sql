-- QuietQueue: the three tables the app needs.
--
-- For Touseef: run this whole file top to bottom in the Supabase SQL editor
-- (Dashboard > SQL Editor > New query > paste > Run). The order matters,
-- because visitors and service_events both point at queues.
--
-- This file mirrors src/lib/types.ts. If you change a column here, change it
-- there too, or the TypeScript will stop matching the database.

-- ============================================================================
-- 1. queues — one line of people
-- ============================================================================
create table if not exists public.queues (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  -- How long one person takes on average, in seconds. Default 300 = 5 minutes.
  avg_service_seconds integer     not null default 300,
  -- A visitor gets an alert when this many people are ahead of them.
  alert_at_position   integer     not null default 3,
  -- Staff can speed the queue up or slow it down.
  -- 1 is normal, 2 is twice as fast, 0.5 is half speed.
  -- The range below matches toSpeed() in src/lib/validate.ts.
  speed_multiplier    real        not null default 1.0
    constraint queues_speed_multiplier_range check (speed_multiplier between 0.25 and 4),
  created_at          timestamptz not null default now()
);

comment on table public.queues is 'One line of people waiting to be served.';


-- ============================================================================
-- 2. visitors — one person in a queue
-- ============================================================================
create table if not exists public.visitors (
  id         uuid primary key default gen_random_uuid(),
  queue_id   uuid        not null references public.queues (id) on delete cascade,
  -- The number on the ticket, in order of arrival.
  ticket_no  integer     not null,
  name       text        not null,
  -- Optional. Only needed if we add SMS later.
  phone      text,
  status     text        not null default 'waiting'
    constraint visitors_status_valid
    check (status in ('waiting', 'called', 'served', 'cancelled')),
  -- True once we have told this visitor they are nearly up. Stops us alerting
  -- the same person twice.
  alerted    boolean     not null default false,
  joined_at  timestamptz not null default now(),
  called_at  timestamptz,
  served_at  timestamptz,

  -- Two visitors can never share a ticket number in the same queue. If two
  -- join at the same instant, the second insert is refused and the app retries
  -- with a fresh number. Without this, staff could call one person twice.
  constraint visitors_queue_ticket_unique unique (queue_id, ticket_no)
);

comment on table public.visitors is 'One person in a queue.';

-- Speeds up the staff list query, which always filters by queue and status and
-- then sorts by ticket number.
create index if not exists visitors_queue_status_ticket_idx
  on public.visitors (queue_id, status, ticket_no);


-- ============================================================================
-- 3. service_events — how long each visit really took
-- ============================================================================
create table if not exists public.service_events (
  id               uuid primary key default gen_random_uuid(),
  queue_id         uuid        not null references public.queues (id) on delete cascade,
  visitor_id       uuid        not null references public.visitors (id) on delete cascade,
  -- How long that visitor actually took, in seconds.
  duration_seconds integer     not null constraint service_events_duration_not_negative check (duration_seconds >= 0),
  created_at       timestamptz not null default now()
);

comment on table public.service_events is
  'One row per finished visitor. We average these to see how fast the desk is really moving.';

-- Supports getRecentServiceDurations(), which reads the newest rows for a queue.
create index if not exists service_events_queue_created_idx
  on public.service_events (queue_id, created_at desc);


-- ============================================================================
-- 4. Security (for Asad)
-- ============================================================================
-- Row Level Security is ON. Every query from a browser is checked against these
-- policies before it runs.
--
-- We only give the browser permission to READ. Every write goes through our API
-- routes, which use the service role key and skip RLS. That means all the
-- authorisation checks live in route code, not here.
--
-- Amna needs this read access: her screens subscribe to Realtime using the
-- anon key, and Realtime obeys these same policies. Without a SELECT policy
-- her live updates would arrive empty.
--
-- IMPORTANT: Postgres has no "create policy if not exists", so we drop each
-- policy first. That makes the whole file safe to paste again after you change
-- a column later. Without these drops, a second run fails on the first
-- existing policy and rolls the whole batch back.

alter table public.queues          enable row level security;
alter table public.visitors        enable row level security;
alter table public.service_events  enable row level security;

drop policy if exists "anyone can read queues" on public.queues;
drop policy if exists "anyone can read visitors" on public.visitors;
drop policy if exists "anyone can read service events" on public.service_events;

create policy "anyone can read queues"
  on public.queues for select to anon, authenticated using (true);

create policy "anyone can read visitors"
  on public.visitors for select to anon, authenticated using (true);

create policy "anyone can read service events"
  on public.service_events for select to anon, authenticated using (true);

-- Note: there are deliberately NO insert, update or delete policies.
-- The browser cannot write to these tables at all.


-- ============================================================================
-- 5. Live updates (for Amna)
-- ============================================================================
-- Send the old row values as well as the new ones on UPDATE and DELETE.
-- Amna checks the previous status to decide whether to refetch, and needs the
-- old values to do that.
alter table public.visitors replica identity full;
alter table public.queues   replica identity full;

-- Publish visitors and queues to the Realtime channel.
-- service_events is not published: Amna's screens subscribe to visitors and
-- queues only, and one message per finished visit would just be noise.
--
-- Postgres has no "add to publication if not present". So we remove the tables
-- from the publication first, then add them back. That way re-running this file
-- does not fail with "relation is already member of publication" and roll the
-- whole batch back.
alter publication supabase_realtime drop table public.visitors;
alter publication supabase_realtime drop table public.queues;

alter publication supabase_realtime add table public.visitors;
alter publication supabase_realtime add table public.queues;


-- ============================================================================
-- 6. Demo data (F7: "Simulate Visitors") — optional
-- ============================================================================
-- Creates one queue with four waiting visitors, so Amna's dashboard has
-- something to show straight away.
--
-- Guarded so it only happens ONCE. Without the "where not exists" check, a
-- second run would create a duplicate queue and then fail on the ticket number
-- unique constraint, which would roll back the entire file.

insert into public.queues (name)
select 'Main Queue'
where not exists (select 1 from public.queues where name = 'Main Queue');

insert into public.visitors (queue_id, ticket_no, name, status)
select q.id, t.ticket_no, t.name, 'waiting'
from (values
  (1, 'Ammar'),
  (2, 'Amna'),
  (3, 'Touseef'),
  (4, 'Asad')
) as t(ticket_no, name)
cross join public.queues q
where q.name = 'Main Queue'
  and not exists (
    select 1 from public.visitors v
    where v.queue_id = q.id and v.ticket_no = t.ticket_no
  );