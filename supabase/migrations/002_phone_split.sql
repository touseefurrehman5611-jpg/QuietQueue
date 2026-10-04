-- ============================================================================
-- 002: Move visitor phone numbers out of the publicly readable table
-- ============================================================================
--
-- WHY THIS FILE EXISTS
--
-- 001_init.sql grants the browser read access to `visitors`, because Amna's
-- screens subscribe to Realtime with the anon key and Realtime obeys these same
-- policies:
--
--   create policy "anyone can read visitors"
--     on public.visitors for select to anon, authenticated using (true);
--
-- That is correct for everything the frontend needs. It has one problem.
-- `visitors` also carried a `phone` column, and the anon key is public by
-- definition -- it ships in the browser bundle. So the policy meant anyone who
-- loaded the app could run
--
--   select * from visitors
--
-- and read every visitor's name AND phone number. Row level security is
-- row-level: there is no way to write a policy that hides one column and shows
-- the rest of the row. The column had to move to its own table.
--
-- This does not change anything the frontend can see. `visitors` keeps every
-- column it had except `phone`, so Amna's Realtime subscription keeps working
-- exactly as before, and her fetch calls keep returning the same rows. The
-- phone number is still returned to the STAFF screen, because /api/queue/list
-- reads it through the service role key, which bypasses RLS and is server-only.
--
-- SAFE TO RUN TWICE. Every statement is idempotent, and the data movement runs
-- before the column is dropped, so a second run moves nothing and drops nothing.
-- Paste it into the Supabase SQL editor after 001_init.sql.

-- ============================================================================
-- 1. The new table
-- ============================================================================

create table if not exists public.visitor_phones (
  visitor_id uuid primary key references public.visitors(id) on delete cascade,
  -- Digits only, 7 to 15 of them. validate.ts is what enforces that; this
  -- column is a second line of defence, not the first.
  phone text not null
);

-- ============================================================================
-- 2. Security (for Asad)
-- ============================================================================
--
-- RLS on, and NO select policy. This is the whole point of the file.
--
-- An enabled RLS table with no policy is the closed state: every query is
-- checked, and there is no rule that lets anything through. So `anon` and
-- `authenticated` read nothing here, and the service role key our API routes
-- use still bypasses RLS entirely and reads it fine.
--
-- Re-running is safe because Postgres has no "create policy if not exists". We
-- drop first, so if you ever add a policy here later, re-pasting this file will
-- not roll the whole batch back.

alter table public.visitor_phones enable row level security;

drop policy if exists "anyone can read visitor phones" on public.visitor_phones;

-- Note: there are deliberately NO policies at all on this table. Not even a
-- select. If you find yourself adding one, phone numbers are the reason this
-- table exists -- the only role that needs to read it is the service role.

-- ============================================================================
-- 3. Move the data, then drop the column
-- ============================================================================
--
-- Order matters. Copy first, drop second. The reverse would lose every phone
-- number ever collected.
--
-- `where phone is not null` skips visitors who gave no number. They get no row
-- in the new table, which is the correct outcome: the absence of a row means
-- "no phone", exactly like the old null did.

insert into public.visitor_phones (visitor_id, phone)
  select id, phone
  from public.visitors
  where phone is not null
  on conflict (visitor_id) do nothing;

alter table public.visitors drop column if exists phone;

-- ============================================================================
-- 4. Indexes
-- ============================================================================
--
-- Nothing new is needed. Every read goes through visitor_id, which is already
-- the primary key of this table, so it is indexed by definition.

-- ============================================================================
-- 5. Live updates
-- ============================================================================
--
-- visitor_phones is deliberately NOT added to the supabase_realtime
-- publication. Staff screens do not subscribe to it: /api/queue/list already
-- returns the phone with everything else, and a Realtime event on a phone
-- number is a phone number pushed to a browser that asked for nothing.

-- ============================================================================
-- 6. What the application now looks like
-- ============================================================================
--
-- Touseef: `visitors` no longer has a `phone` column. Columns are now
--   id, queue_id, ticket_no, name, status, alerted,
--   joined_at, called_at, served_at
-- The phone lives in `visitor_phones(visitor_id, phone)`, one row per visitor
-- who gave one. Both files agree: src/lib/db.ts VisitorRow, and src/lib/types.ts
-- Visitor.
--
-- Amnar's Realtime subscription on `visitors` is unchanged and unaffected.
--
-- Asad: the anon key can still read `visitors` in full -- that is needed and
-- correct. It can read NOTHING from `visitor_phones`.
