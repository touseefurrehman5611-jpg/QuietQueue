# QuietQueue API Contract

**Owner: Ammar (Backend). Anyone changing a response shape must tell Amna before merging.**

This is the agreement between the backend and Amna's frontend. Both sides code
against this document. If a field is renamed, removed, or changes type, this file
changes in the same commit.

---

## The one rule that matters

Every endpoint answers with the same envelope. Check `ok` first; do not check the
HTTP status.

**Success** — HTTP 200, or 201 for creating something:

```json
{ "ok": true, "data": { ... } }
```

**Failure** — HTTP 400 (bad input), 404 (nothing there), 409 (wrong state), or 500:

```json
{ "ok": false, "error": "a sentence explaining what went wrong" }
```

`error` is always a human-readable string. It is safe to show it in the UI
directly, and it is the intended way to debug.

A 500 means the database or the AI call failed. The message says which.

---

## Endpoints

Base URL in development: `http://localhost:3000`

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/api/queue/join` | visitor | Take a ticket, get an estimate back |
| GET | `/api/queue/status?visitorId=` | visitor | Poll for position and wait |
| POST | `/api/ai/message` | visitor | Turn an estimate into one friendly sentence |
| GET | `/api/queue/list?queueId=` | staff | The whole line plus dashboard numbers |
| POST | `/api/queue/next` | staff | Call the next person waiting |
| POST | `/api/queue/done` | staff | Finish the person at the desk |
| POST | `/api/queue/cancel` | either | Remove somebody who left |
| POST | `/api/queue/speed` | staff | Move the speed slider |

---

### POST `/api/queue/join`

Visitor signs up.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `queueId` | string | yes | The queue's id |
| `name` | string | yes | Cannot be empty or whitespace |
| `phone` | string | no | Ignored unless it is a non-empty string |

**Response — 201**

```json
{
  "ok": true,
  "data": {
    "visitorId": "uuid",
    "ticketNo": 5,
    "queueName": "Main Queue",
    "position": 5,
    "peopleAhead": 4,
    "minMinutes": 16,
    "maxMinutes": 24,
    "shouldAlert": false
  }
}
```

Save `visitorId`. Every later call needs it.

**Errors** — 400 `queueId is required` / `name is required` / bad queue id, 500 if the database is unreachable.

---

### GET `/api/queue/status?visitorId=`

What the visitor polls. Suggest every 5 seconds — the wait only changes when
somebody is called or finishes, and Realtime will not fire for the maths.

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "status": "waiting",
    "ticketNo": 5,
    "queueName": "Main Queue",
    "position": 5,
    "peopleAhead": 4,
    "minMinutes": 16,
    "maxMinutes": 24,
    "shouldAlert": false,
    "alerted": false
  }
}
```

`status` is one of `waiting`, `called`, `served`, `cancelled`.

**Important cases**

- **`status` is `called`** — you are at the desk. `position` is 1, all three
  wait numbers are 0, and `shouldAlert` is `true`.
- **`status` is `served` or `cancelled`** — the visit is over. `position`,
  `peopleAhead`, `minMinutes` and `maxMinutes` are all `null`. This is the only
  place the frontend gets `null` for those four fields, so check `status` before
  rendering numbers.
- **`shouldAlert` just turned true** — show the notification and call
  `/api/ai/message`. The backend sets `alerted` to true automatically on that
  poll, so you only notify once: **notify when `shouldAlert && !previousAlerted`.**

**Errors** — 400 `visitorId is required`, 404 `not found` if that id does not exist, 500 on a database failure.

---

### POST `/api/ai/message`

Writes one friendly sentence. Uses Groq. You can call it the moment
`shouldAlert` becomes true.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `position` | number | yes | Must be 1 or more |
| `peopleAhead` | number | no | Defaults to `position - 1` |
| `minMinutes` | number | no | Defaults to 0 |
| `maxMinutes` | number | no | Defaults to `minMinutes` |
| `shouldAlert` | boolean | no | Treated as false unless exactly `true` |

Copy `position`, `minMinutes`, `maxMinutes` and `shouldAlert` straight from the
`/status` response. Do not recompute them.

**Do not send a name.** This endpoint deliberately ignores any `visitorName` you
pass — only queue numbers and minutes go to Groq, so no personal data leaves the
server. Personalise on the client instead: put the name in your own UI around the
returned sentence.

**Response — 200**

```json
{ "ok": true, "data": { "message": "You are number 3 in line, about 12 to 18 minutes to wait.", "source": "groq" } }
```

****`source` matters.** It is `groq` when the AI wrote it, or `fallback` when it
could not be reached. `reason` is also present on a fallback and explains why
(missing key, timeout, rate limit, wrong model).

Check `source` during testing. If it always says `fallback` with a
`model_not_found` reason, `GROQ_MODEL` names a model your key cannot reach — see
the comment at the top of `src/app/api/ai/message/route.ts`.

**This endpoint does not fail for an AI problem.** It always returns `ok: true`
with a usable `message`. If the model is down you still get a correct plain
sentence. Do not build an error state for it — there is nothing to retry.

**Errors** — only 400 if `position` is missing or the body is not a JSON object, and 500 on a programming fault.

---

### GET `/api/queue/list?queueId=`

The staff screen. Poll every 5 seconds, or subscribe to Realtime on `visitors`
and refetch on any change.

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "queue": {
      "id": "uuid",
      "name": "Main Queue",
      "speedMultiplier": 1,
      "alertAtPosition": 3
    },
    "waiting": [ /* visitor objects, oldest ticket first */ ],
    "called": [ /* visitor objects */ ],
    "stats": { "servedCount": 12, "avgWaitMinutes": 14.5 }
  }
}
```

`waiting` and `called` are already split and already sorted by `ticketNo`, so
the frontend never filters or sorts. `called` holds everyone currently at the
desk.

**A visitor object** (also returned by `join`, `next`, `done`, `cancel`):

| Field | Type | Notes |
|---|---|---|
| `id` | string | uuid |
| `queueId` | string | uuid |
| `ticketNo` | number | Position in line by arrival |
| `name` | string | |
| `phone` | string or null | |
| `status` | string | `waiting` / `called` / `served` / `cancelled` |
| `alerted` | boolean | True once the visitor has been notified |
| `joinedAt` | string | ISO timestamp |
| `calledAt` | string or null | ISO timestamp |
| `servedAt` | string or null | ISO timestamp |

**`stats.avgWaitMinutes` is `null` before anyone has been served**, not 0. Show
"no data yet" rather than 0 minutes — a zero average reads as an instant queue
and looks like a bug.

**Errors** — 400 `queueId is required` / `request body must be a JSON object`, 404 `not found` for an id that does not exist, 500 on a database failure.

**A 404 carries the message `"not found"` and a 500 carries `"something went
wrong on our side"`.** We deliberately do not pass the raw database error to the
browser — it contains table and column names. The real reason is in the server
log, so if you get an unexpected 500, check the terminal running `npm run dev`.

---

### POST `/api/queue/next`

Staff press one button. Calls the person with the lowest ticket number who is
still `waiting`. People already `called` are skipped, so pressing it twice never
skips somebody.

**Request body** — `{ "queueId": "uuid" }`

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "visitor": { "...": "visitor object" },
    "message": "Ticket 5 (Ammar) please come to the desk."
  }
}
```

**Errors** — 400 `queueId is required` / `request body must be a JSON object`, 404 `nobody is waiting in this queue`.

---

### POST `/api/queue/done`

Staff finish with the person at the desk. Records how long it really took, which
is what makes the estimate improve over the day.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `visitorId` | string | yes | Must be `called` |
| `simulatedSeconds` | number | no | Demo only — pretend the visit took this long. Whole number, 0 or more. Without it we time from `calledAt` to now. |

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "visitor": { "...": "visitor object" },
    "durationSeconds": 137,
    "simulated": false
  }
}
```

`simulated` tells you whether the duration was real or faked.

**Errors** — 400 `visitorId is required` / `request body must be a JSON object`, 404 `not found`, **409 `visitor is <status>, not called`**.
The 409 matters: it means the staff screen is out of sync with the backend, so
do not retry, just refetch `/list`.

---

### POST `/api/queue/cancel`

Somebody left. Takes them out without renumbering anybody else.

**Request body** — `{ "visitorId": "uuid" }`

**Response — 200** — `{ "ok": true, "data": { "visitor": { ... } } }`

**Errors** — 400 `visitorId is required` / `request body must be a JSON object`, 404 `not found`, 409 `visitor has already been served` / `visitor is already cancelled`.

---

### POST `/api/queue/speed`

Staff move the speed slider. 1 is normal, 2 is twice as fast, 0.5 is half.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `queueId` | string | yes | |
| `speedMultiplier` | number | yes | Between **0.25** and **4** |

**Response — 200**

```json
{ "ok": true, "data": { "queue": { "id": "uuid", "name": "Main Queue", "avgServiceSeconds": 300, "alertAtPosition": 3, "speedMultiplier": 2, "createdAt": "..." } } }
```

**Errors** — 400 `queueId is required` / `request body must be a JSON object` / `speedMultiplier must be a number between 0.25 and 4`, 404 `not found` for a bad queue id. The range is enforced twice — here and by a database constraint — so a bad value can never break the estimate.

An **empty string is not zero**. If a number field is left blank you get a 400,
not a silent 0 — which matters, because a silent 0 would be recorded as a real
measurement instead of falling back to the true value.

---

## How the wait estimate works

Worth knowing so the UI does not contradict it.

1. **People ahead** — everyone still in the line (`waiting` or `called`) with a
   lower ticket number. Your position is that plus one.
2. **How long a visit takes** — the average of the last few real visits
   (`service_events`), but only once there are at least 3 of them. Before that it
   uses the queue's own `avgServiceSeconds` (300 = 5 minutes by default).
3. **Speed** — the estimate is divided by `speedMultiplier`. Staff moving the
   slider changes every estimate immediately.
4. **The window** — the middle number, then 0.8x to 1.2x of it, rounded up. So 3
   people at 5 minutes each gives `12 to 18 minutes`, never a single number.
5. **`shouldAlert`** — true when people ahead is **3 or fewer**, not when the wait
   is short. It is about how close you are in line, not how many minutes you
   have.

---

## Live updates

Supabase Realtime is enabled on `visitors` and `queues`. Amna subscribes with the
anon key and the read policies already allow it.

```js
const channel = supabase
  .channel("queue")
  .on("postgres_changes", { event: "*", schema: "public", table: "visitors" }, refetch)
  .subscribe();
```

**A Realtime event tells you something changed, not what the new state is.** The
simplest correct build is to refetch `/list` on any event. Do not try to
reconstruct the list from the payload.

Polling still works fine on its own if Realtime gives trouble — 5 seconds for
both `/status` and `/list`.

---

## Never put these in a response

- `SUPABASE_SERVICE_ROLE_KEY` — server only, it bypasses row level security
- `GROQ_API_KEY` — server only

Both live in `.env.local`, which is gitignored. No endpoint returns them.

---

## Quick test script

With the dev server running (`npm run dev`), in order:

```bash
# 1. join (need a real queueId — see below)
curl -X POST localhost:3000/api/queue/join -H "Content-Type: application/json" \
  -d '{"queueId":"<queueId>","name":"Ammar"}'

# 2. poll as that visitor
curl "localhost:3000/api/queue/status?visitorId=<visitorId>"

# 3. staff view
curl "localhost:3000/api/queue/list?queueId=<queueId>"

# 4. call the next person
curl -X POST localhost:3000/api/queue/next -H "Content-Type: application/json" \
  -d '{"queueId":"<queueId>"}'

# 5. finish them, pretending it took 2 minutes
curl -X POST localhost:3000/api/queue/done -H "Content-Type: application/json" \
  -d '{"visitorId":"<visitorId>","simulatedSeconds":120}'

# 6. faster desk
curl -X POST localhost:3000/api/queue/speed -H "Content-Type: application/json" \
  -d '{"queueId":"<queueId>","speedMultiplier":2}'

# 7. a friendly sentence
curl -X POST localhost:3000/api/ai/message -H "Content-Type: application/json" \
  -d '{"position":3,"minMinutes":12,"maxMinutes":18,"shouldAlert":true}'
```

**Getting a `queueId`** — run the SQL in `supabase/migrations/001_init.sql` and it
creates one queue called "Main Queue" with four visitors already in it. Then:

```sql
select id, name from public.queues;
```

**These will all return 500 until `.env.local` has real Supabase keys.** That is
the missing-keys error, not a broken route.
