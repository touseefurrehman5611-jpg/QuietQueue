# QuietQueue

Smart queue management without standing in line.

A visitor joins from their phone and watches their position and estimated wait
move in real time. Staff call the next person, mark them served, or cancel them,
and the wait estimate gets more accurate from every real visit.

## Features

- Join with a name and an optional phone number
- Live position and an estimated wait window, from a moving average of how long
  visits have actually been taking
- Staff dashboard: call next, mark done, cancel, set the desk speed
- Turn alerts when somebody is close to the front, never sent twice
- AI-written alert messages with a fixed fallback, so a slow or failed model
  call never leaves the screen blank
- Realtime updates plus a poll, so a dropped websocket degrades instead of
  freezing
- Simulate visitors, for demoing on an empty queue

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- API routes on the server, Supabase Postgres behind them
- Supabase Realtime for live updates
- Groq for the AI message

## Setup

```bash
npm install
cp .env.example .env.local     # fill in the Supabase values
```

Then, in the Supabase SQL editor, run these three files **in order**:

1. `supabase/migrations/001_init.sql` — tables, policies, seed data
2. `supabase/migrations/002_phone_split.sql` — moves phone numbers off the
   publicly readable `visitors` table
3. `supabase/migrations/003_reconcile_amna_schema.sql` — only needed if you
   previously built the database from the old `supabase-schema.sql`. It is a
   no-op otherwise.

Then:

```bash
npm run dev
```

- `/` — landing page
- `/visitor` — join, or paste a visitor id to check status
- `/staff` — the dashboard

## Tests

```bash
npm test          # pure logic: prediction, AI fallback, validation
npm run build     # type checks every page and route
npm run smoke -- <queueId>   # needs a running dev server + a real database
```

`npm test` runs three self-checks that need no database and no API key. The
smoke test writes real rows: get an id with
`select id, name from public.queues;` and point it at a scratch queue, not the
one you are demoing from.

## How the wait estimate works

`src/lib/prediction.ts` is the whole of it. People ahead, times the average
service time, divided by how fast the desk is running, giving a middle estimate
and a window of 0.8x to 1.2x of it.

The average is the interesting part. A queue is created with a guess
(300 seconds). Once three or more real visits have been recorded, the moving
average of the last five wins over the guess — because three real visits are
evidence and a number somebody typed into a form is not. Below three, the
guess stands, because swinging the whole dashboard on one sample looks broken.

Alerts fire on **position in line**, not on minutes. Someone third in line
waits almost nothing and still needs to know to come to the desk. The `alerted`
column flips false to true exactly once, which is what makes "alert me when it
is my turn" safe to actually send.

## Layout

```
src/app/api/          route handlers, one directory per endpoint
src/app/staff         staff dashboard
src/app/visitor       join form, and the live status screen
src/components/       shared UI
src/lib/prediction.ts wait maths - pure, no database
src/lib/db.ts         every database read and write
src/lib/validate.ts   everything that arrives from the internet
src/lib/respond.ts    the {ok, data} / {ok, error} envelope
supabase/migrations/  schema, in the order it must be run
```

Every route answers in the same envelope, so `src/lib/api.ts` is the only place
on the client that has to know it.

## Security notes

- The anon key can **read** `queues`, `visitors` and `service_events`. It cannot
  write anything, and it cannot read `visitor_phones` at all.
- Phone numbers live in their own table with no read policy, because RLS works
  per row and cannot hide a single column. `/api/queue/list` is the only
  endpoint that ever sends one, and it reads through the service role.
- Every server route uses the service role key, which bypasses RLS entirely.
  `STAFF_KEY` gates the five staff routes. **It is optional** — with it unset
  the routes are open, which is right on localhost and wrong anywhere else.
  Set it before you deploy.