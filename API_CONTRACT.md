# QuietQueue API Contract

**Owner: Ammar (Backend). Anyone changing a response shape must tell Amna before merging.**

This is the agreement between the backend and Amna's frontend. Both sides code
against this document. If a field is renamed, removed, or changes type, this file
changes in the same commit.

Every example JSON below was copied out of the route code as it stands today.

---

## What changed since the first draft

If you already coded against the first version of this file, this is the list of
things you have to go and fix. Nothing else changed.

### You can stop calling `/api/ai/message` — this is the big one

`/api/queue/status` now returns a `message` field. It is already written for you,
ready to render or drop into a browser notification. The normal visitor flow does
not need `/api/ai/message` at all any more. You can delete that call and the state
that held its result.

`/api/ai/message` is still there and still works, in case you want a sentence at a
moment `/status` cannot know about (like the moment you first join). Both call
shapes are documented below.

### BREAKING — `/status` `position` is now `0` when `status` is `called`

It used to be `1`. Now it is `0`, because you are not first in line any more — you
are off the line. `peopleAhead`, `minMinutes` and `maxMinutes` are all `0` too.

**If you wrote `position === 1` to detect "it's my turn", that is now wrong and will
never fire.** Use `status === "called"`.

### BREAKING — `/next` 404 message changed

It used to say `"nobody is waiting in this queue"`. It now says:

```
"No one is waiting"
```

If you match on the old string to show "nobody left in the queue", update it.

### BREAKING — `/status` does not write the `alerted` flag any more

The old doc said "the backend sets `alerted` to true automatically on that poll, so
you only notify once". **That is no longer true, and it was the reason you would
have got duplicate notifications.** See the *How alerting actually works* section
below. Notify on the client-side transition, not on the `alerted` value.

### ADDED — `/status` returns three new fields

`visitorId`, `name` and `message`. See the route section for exactly when `message`
is a string and when it is `null`.

### ADDED — `/list` visitors each carry their own estimate

Every visitor in `waiting` and `called` now has `position`, `peopleAhead`,
`minMinutes`, `maxMinutes` and `shouldAlert` added to them.

**Nothing was removed.** Every field you had before is still there, including
`phone`, which the staff screen wants. You can show "3rd in line, about 12 to 18
min" without doing any arithmetic yourself.

### ADDED — `/list` `stats` has a third number

`stats.avgServiceMinutes` now sits next to `servedCount` and `avgWaitMinutes`.

### ADDED — `/done` returns `stats`

`/done` now sends `stats` back with the visitor, so your dashboard can update from
that one call instead of immediately refetching `/list`.

### CHANGED — `/speed` accepts two field names

Both `multiplier` and `speedMultiplier` work. Send whichever you already wrote.
If both are present, `multiplier` wins.

### CHANGED — `/ai/message` accepts two request shapes

`{ visitorId, type }` (new, short — we look the visitor up ourselves) and
`{ position, minMinutes, maxMinutes, shouldAlert }` (the old one). Both are
documented below. Your existing calls still work.

### Unchanged

`/join`'s response is unchanged. `/list`'s top-level shape is unchanged. `/cancel`
and `/next` are unchanged apart from the `/next` 404 message.

---

## The one rule that matters

Every endpoint answers with the same envelope. Check `ok` first; do not branch on
the HTTP status.

**Success** — HTTP 200, or 201 for creating something:

```json
{ "ok": true, "data": { ... } }
```

**Failure** — HTTP 400 (bad input), 403 (staff key), 404 (nothing there),
409 (wrong state), or 500:

```json
{ "ok": false, "error": "a sentence explaining what went wrong" }
```

`error` is always a human-readable string. It is safe to show in the UI directly,
and it is the intended way to debug. There is no `data` key on a failure, and no
`error` key on a success — so check `ok` before you read anything else.

A 500 means the database or the AI call failed. The message says which.

---

## Endpoints

Base URL in development: `http://localhost:3000`

| Method | Path | Who calls it | Purpose |
|---|---|---|---|
| POST | `/api/queue/join` | visitor | Take a ticket, get an estimate back |
| GET | `/api/queue/status?visitorId=` | visitor | Poll for position, wait and a ready-made message |
| POST | `/api/ai/message` | visitor | Turn an estimate into one friendly sentence (optional) |
| GET | `/api/queue/list?queueId=` | staff | The whole line plus dashboard numbers |
| POST | `/api/queue/next` | staff | Call the next person waiting |
| POST | `/api/queue/done` | staff | Finish the person at the desk |
| POST | `/api/queue/cancel` | either | Remove somebody who left |
| POST | `/api/queue/speed` | staff | Move the speed slider |

Five of those eight check the optional staff key. See *The optional staff key*.

---

### POST `/api/queue/join`

Visitor signs up. Saves them, then immediately tells them where they are in line.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `queueId` | string | yes | Trimmed for you. Must be a real queue. |
| `name` | string | yes | Trimmed. 2 to 40 characters after trimming. |
| `phone` | string | no | Optional. Digits only — stored as digits. |

`phone` is checked properly: missing, `null` and `""` all mean "no phone" and are
fine. Anything else must be 7 to 15 digits once punctuation is stripped, so
`"+92 (300) 123-4567"` and `"03001234567"` are both accepted and stored as
`923001234567`.

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

Save `visitorId`. Every later call needs it. `name` is **not** echoed back here —
`/status` is where you get it, so do not try to render it from this response.

**Errors** — all 400 unless noted

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | No body, broken JSON, or a body that is an array or a bare value |
| 400 | `queueId is required` | Missing, empty, or whitespace |
| 400 | `name must be at least 2 characters` | Missing, not a string, or 1 character after trimming |
| 400 | `name must be at most 40 characters` | Over 40 characters after trimming |
| 400 | `phone must be a number` | Present but not a string |
| 400 | `phone must be 7 to 15 digits` | Present but the wrong number of digits |
| 400 | `invalid id format` | `queueId` is not even shaped like a uuid |
| 404 | `not found` | `queueId` looks like a uuid but no such queue exists |
| 500 | `something went wrong on our side` | Database unreachable, or a service-role key that is not set |

---

### GET `/api/queue/status?visitorId=`

What the visitor polls. Suggest every 5 seconds. This is the visitor's only call.

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `visitorId` | string | yes | The id `/join` gave you |

**Response — 200**

Three different shapes come back from this one route, decided by `status`. All
three have the same keys.

```json
{
  "ok": true,
  "data": {
    "visitorId": "uuid",
    "ticketNo": 5,
    "name": "Ammar",
    "status": "waiting",
    "queueName": "Main Queue",
    "position": 5,
    "peopleAhead": 4,
    "minMinutes": 16,
    "maxMinutes": 24,
    "shouldAlert": false,
    "alerted": false,
    "message": null
  }
}
```

`status` is one of `waiting`, `called`, `served`, `cancelled`.

#### When `status` is `waiting`

| Field | Type | Notes |
|---|---|---|
| `position` | number | 1 means you are next |
| `peopleAhead` | number | How many people are ahead of you |
| `minMinutes` / `maxMinutes` | number | The window. Both `0` if nobody is ahead |
| `shouldAlert` | boolean | True when `peopleAhead` is 3 or fewer |
| `message` | string or **null** | A ready-made sentence, or `null` |
| `alerted` | boolean | Whether the server has marked you as alerted. See below |

#### When `status` is `called`

```json
{
  "ok": true,
  "data": {
    "visitorId": "uuid",
    "ticketNo": 5,
    "name": "Ammar",
    "status": "called",
    "queueName": "Main Queue",
    "position": 0,
    "peopleAhead": 0,
    "minMinutes": 0,
    "maxMinutes": 0,
    "shouldAlert": true,
    "alerted": true,
    "message": "Please come to the desk."
  }
}
```

All four numbers are `0`, not `null`, and `shouldAlert` is always `true`. There is
no wait left, so there is nothing to estimate — and no Groq call is made for this,
because it is the highest-stakes moment in the whole flow and there is exactly one
right sentence for it.

**`alerted` is not guaranteed `true` here.** The example above shows the common
case, but `checkAndMarkAlerts` only ever marks visitors who are still `waiting`. A
visitor who was called while they were deep in the line, without a staff action ever
sliding them into the alert window first, arrives here with `alerted: false`. That is
harmless — **branch on `status === "called"`, never on `alerted`.**

#### When `status` is `served` or `cancelled`

```json
{
  "ok": true,
  "data": {
    "visitorId": "uuid",
    "ticketNo": 5,
    "name": "Ammar",
    "status": "served",
    "queueName": "Main Queue",
    "position": null,
    "peopleAhead": null,
    "minMinutes": null,
    "maxMinutes": null,
    "shouldAlert": false,
    "alerted": false,
    "message": null
  }
}
```

**These four numbers are `null`, not `0`,** and that is deliberate. `null` means
"there is no wait left to measure", which is different from a measured zero. So on
the "thanks for waiting" screen, check `status` before you render any numbers, or
you will render four `null`s as `NaN`.

`queueName` and `name` are still filled in, so the field is never missing.

#### About `message`

`message` is decided on the server, so you never have to write a sentence or call
anything else:

- `status` is `called` → the fixed string `"Please come to the desk."`
- `status` is `waiting` **and** `shouldAlert` is true → a sentence Groq wrote about
  your current numbers
- anything else → `null`, because an ordinary wait is just numbers on a screen and
  a model call on every poll for every visitor would be slow and pointless

So: `null` is the normal case and needs no handling. Render it when it is a string.

Note the sentence is **not frozen**. A visitor sitting inside the alert window gets
a fresh sentence on every poll, so the wording always matches the numbers currently
on their screen.

#### About `alerted`

`alerted` is a **database column that only one function writes.** Read it if you
like, but do not drive your notifications off it — see *How alerting actually works*.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `visitorId is required` | Missing, empty, or whitespace |
| 400 | `invalid id format` | Not shaped like a uuid |
| 404 | `Visitor not found` | Looks like a uuid, no such visitor. Note the capital V — this one is worded by hand, not by the generic handler |
| 500 | `something went wrong on our side` | Database failure |

---

### How alerting actually works

This is the one thing that is easy to get wrong, so read it before you wire up a
notification.

**Two different things are called "the alert".**

1. `shouldAlert` — a number this route computes every poll from how far back you
   are. It can be true, then false, then true again if people join behind you.
2. `alerted` — a database column meaning "we have permanently recorded that this
   visitor was alerted, do not tell them again". It only ever goes false → true.

`/status` **does not write `alerted`.** `checkAndMarkAlerts` in `src/lib/alerts.ts`
owns that column and only that function writes it. It runs on `join`, and after
`next`, `done` and `cancel` — the moments when somebody joins or the alert window
slides — not on every poll. (`join` needs it because someone joining an empty
queue lands inside the window immediately, with no staff action to trigger it.)

That is deliberate: one owner for one flag. Two writers would race each other and
the "never alert twice" promise would become two half-promises.

**So notify on the client-side transition into the window:**

```js
if (data.shouldAlert && !previousShouldAlert) {
  showNotification(data.message);
}
```

Keep `previousShouldAlert` in a `useRef` or state. Compare against the *previous
poll's* `shouldAlert`, never against the `alerted` column.

- **Do not** notify on `alerted` becoming true. It is written by a different
  endpoint at a different moment, and you will fire at times you did not plan to.
- **Do not** notify on every poll where `shouldAlert` is true. That is one
  notification every 5 seconds for as long as somebody sits near the front.

Getting this wrong either way is a real bug: transition-based misses notifications
if you get the edge detection wrong, `alerted`-based gives you duplicates.

---

### POST `/api/ai/message`

Turns a wait estimate into one friendly sentence. **Optional** — `/status` already
gives you a message for the normal flow.

Two request shapes are accepted. Send one, not both.

#### Shape 1 — `{ visitorId, type }` (shorter, recommended)

You give us the id, we look the visitor up and work out the numbers ourselves. This
way your numbers can never drift out of step with the backend's.

| Field | Type | Required | Notes |
|---|---|---|---|
| `visitorId` | string | yes | A visitor who is still in a queue |
| `type` | string | yes | One of `joined`, `alert`, `delay`, `called` |

`joined` is for right after they take a ticket. `alert` is for "you are nearly up".
`delay` is for "sorry, it is longer than we said". `called` is for "come to the
desk".

```json
{ "visitorId": "uuid", "type": "alert" }
```

If that visitor has already left the queue, you get a polite goodbye instead of an
estimate — that is a success, not an error:

```json
{
  "ok": true,
  "data": {
    "message": "Your visit is finished. Thank you for waiting.",
    "source": "fallback",
    "reason": "visitor has left the queue"
  }
}
```

#### Shape 2 — `{ position, minMinutes, maxMinutes, shouldAlert }` (the old one)

You give us the numbers. This is what makes the endpoint testable without a
database behind it.

| Field | Type | Required | Notes |
|---|---|---|---|
| `position` | number | yes | A whole number, 1 or more |
| `peopleAhead` | number | no | Accepted and ignored |
| `minMinutes` | number | no | Defaults to 0 |
| `maxMinutes` | number | no | Defaults to whatever `minMinutes` is |
| `shouldAlert` | boolean | no | Only `true` counts |
| `type` | string | no | Optional. If you send it, it wins over the guess below |

Without a `type`, the server guesses from the numbers so your existing calls keep
producing the same sentences: `position === 1` → `called`, otherwise
`shouldAlert === true` → `alert`, otherwise `joined`.

```json
{ "position": 3, "minMinutes": 12, "maxMinutes": 18, "shouldAlert": true }
```

#### Response — 200, both shapes

```json
{
  "ok": true,
  "data": {
    "message": "You are number 3 in line, about 12 to 18 minutes to wait.",
    "source": "groq"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `message` | string | Always a real sentence. Never empty |
| `source` | `"groq"` or `"fallback"` | Whether the AI wrote it or the plain fallback did |
| `reason` | string, **only on a fallback** | Why: `GROQ_API_KEY is not set`, `Groq returned 429`, `Groq returned no text`, or a network error message |

**Check `source` while testing.** If it always says `fallback`, the AI is not
running. The sentence is still correct either way, so a fallback is not a broken
screen — but it tells the team something is misconfigured. See the comment at the
top of `src/lib/ai.ts` for how to list the models your own key
can reach.

**This endpoint never fails for an AI problem.** Every failure path inside it ends
in a usable plain sentence, so it always returns `ok: true`. Do not build an error
state for it — there is nothing to retry.

**Do not send a name.** This endpoint deliberately ignores any `visitorName` you
pass. Only queue numbers and minutes go to Groq, so no personal data leaves the
server. Personalise on the client instead: put the name in your own UI around the
returned sentence.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | No body, broken JSON, array or bare value |
| 400 | `type must be joined, alert, delay or called` | Shape 1, and `type` is not one of the four words |
| 400 | `position is required` | Shape 2, and `position` is missing, blank, a decimal, or negative |
| 400 | `position must be 1 or more` | Shape 2, and `position` is `0` |
| 400 | `invalid id format` | Shape 1 only. `visitorId` is not uuid-shaped |
| 404 | `not found` | Shape 1 only. uuid-shaped but no such visitor |

Shape 2 never touches the database, so those last two cannot happen on it.
| 500 | `something went wrong on our side` | Database failure |

---

### GET `/api/queue/list?queueId=`

The staff screen. Poll every 5 seconds, or subscribe to Realtime and refetch on any
event.

**Query**

| Field | Type | Required | Notes |
|---|---|---|---|
| `queueId` | string | yes | |

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
    "stats": {
      "servedCount": 12,
      "avgWaitMinutes": 14.5,
      "avgServiceMinutes": 5.4
    }
  }
}
```

`waiting` and `called` are already split and already sorted by `ticketNo`, so the
frontend never filters or sorts. `called` holds everyone currently at the desk, so
you can have more than one if staff called twice without serving.

Note the `queue` object here has **only these four fields** — unlike `/speed`, which
returns the whole queue row. `avgServiceSeconds` and `createdAt` are not in this one.

#### A visitor object

Everything below is in both `waiting` and `called`. Nothing was removed from the
first version — `phone` is still here, because the staff screen wants it.

| Field | Type | Notes |
|---|---|---|
| `id` | string | uuid |
| `queueId` | string | uuid |
| `ticketNo` | number | Position in line by arrival |
| `name` | string | |
| `phone` | string or null | Digits only, or null if they gave none |
| `status` | string | `waiting` / `called` / `served` / `cancelled`. Inside these two arrays it is only ever `waiting` or `called` |
| `alerted` | boolean | True once the server has marked them as alerted |
| `joinedAt` | string | ISO timestamp |
| `calledAt` | string or null | ISO timestamp, set when staff called them |
| `servedAt` | string or null | ISO timestamp, set when staff finished them |

#### A note on where `phone` comes from

**Nothing changed for you.** `phone` is still on every visitor in `waiting` and
`called`, still digits-only, still `null` when the visitor gave none.

What changed is behind it. The phone number is no longer a column on the
`visitors` database table — it lives in a separate `visitor_phones` table that
the browser's public key cannot read. `/list` fetches it server-side and attaches
it, so your staff screen is unaffected.

**Why:** the browser key that powers your Realtime subscriptions can read the
whole `visitors` table, which is correct and needed. But a phone number in that
table meant anyone who opened the app could read every visitor's phone number
straight out of devtools, with no login and no effort. Row-level security cannot
hide one column, so the column had to move.

**This is `/list` only.** `/join` and `/status` never had a phone number and
still do not — those are visitor-facing. If you ever need to show a phone number
on a visitor's own screen, ask first; the answer will still be no.

**Plus these five, which are new** — the estimate, computed per visitor so you can
show "3rd in line, about 12 to 18 min" with no arithmetic on your side:

| Field | Type | Notes |
|---|---|---|
| `position` | number | 1 means next |
| `peopleAhead` | number | |
| `minMinutes` | number | |
| `maxMinutes` | number | |
| `shouldAlert` | boolean | True when `peopleAhead` is 3 or fewer |

Note these five are only added by `/list`. `/next`, `/done` and `/cancel` return a
plain visitor object with no estimate on it.

#### `stats`

| Field | Type | Notes |
|---|---|---|
| `servedCount` | number | Always a number, `0` on a fresh queue |
| `avgWaitMinutes` | number or **null** | Joined to served, in minutes, one decimal place |
| `avgServiceMinutes` | number or **null** | New. How long a visit actually took at the desk |

**The two averages are `null` before there is anything to measure, not `0`.** Show
"no data yet" rather than 0 minutes — a zero average reads as an instant queue and
looks like a bug.

`avgServiceMinutes` comes from the recorded service events, not from joined-to-served
timestamps. That means a demo visit you finished with `simulatedSeconds` still
counts in it.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `queueId is required` | Missing or empty |
| 400 | `invalid id format` | Not uuid-shaped |
| 404 | `not found` | uuid-shaped but no such queue |
| 403 | `not allowed` | Staff key is set and the header was missing or wrong |
| 500 | `something went wrong on our side` | Database failure |

**A 500 deliberately never carries the raw database text.** It contains table and
column names. The real reason is in the server log, so if you get an unexpected 500,
check the terminal running `npm run dev`.

---

### POST `/api/queue/next`

Staff press one button. Calls the person with the lowest ticket number who is
still `waiting`. People already `called` are skipped, so pressing it twice never
skips somebody — it calls the next one.

**Request body** — `{ "queueId": "uuid" }`

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "visitor": { "...": "visitor object, no estimate on it" },
    "message": "Ticket 5 (Ammar) please come to the desk."
  }
}
```

`message` is a plain string built by the server from the ticket and the name. Show
it on the staff screen if you want to.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | |
| 400 | `queueId is required` | |
| 400 | `invalid id format` | |
| 404 | `not found` | uuid-shaped queue id that does not exist |
| 404 | `No one is waiting` | The queue is empty, or everybody in it is already called. **Capital N, capital O, capital W** |
| 403 | `not allowed` | Staff key |
| 500 | `something went wrong on our side` | |

`No one is waiting` is a normal outcome, not a fault. Grey out or disable the
button when `waiting` is empty rather than letting staff press it into an error.

---

### POST `/api/queue/done`

Staff finish with the person at the desk. Records how long it really took, which is
what makes the estimate improve over the day.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `visitorId` | string | yes | Must currently be `called` |
| `simulatedSeconds` | number | no | Demo only. Whole number, 0 or more |

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "visitor": { "...": "visitor object, now status served" },
    "durationSeconds": 137,
    "simulated": false,
    "stats": {
      "servedCount": 13,
      "avgWaitMinutes": 14.2,
      "avgServiceMinutes": 5.2
    }
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `durationSeconds` | number | What was recorded — the real one or the simulated one |
| `simulated` | boolean | `true` if you sent `simulatedSeconds`, `false` if it was timed for real |
| `stats` | object | Same shape as `/list`'s `stats`. New. Use it to update your dashboard without refetching `/list` |

`simulatedSeconds` is ignored unless it is a whole number of 0 or more. A blank
field, a decimal, or a negative number all fall back to real timing rather than
failing — so leaving the input empty is safe.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | |
| 400 | `visitorId is required` | |
| 400 | `invalid id format` | |
| 404 | `not found` | uuid-shaped visitor id that does not exist |
| 409 | `visitor is <status>, not called` | They are `waiting`, `served` or `cancelled`. The `<status>` is filled in |
| 403 | `not allowed` | Staff key |
| 500 | `something went wrong on our side` | |

The 409 matters: it means your staff screen is out of step with the backend, so
**do not retry**. Just refetch `/list`.

---

### POST `/api/queue/cancel`

Somebody left. Takes them out without renumbering anybody else.

**Request body** — `{ "visitorId": "uuid" }`

**Response — 200**

```json
{ "ok": true, "data": { "visitor": { "...": "visitor object, now status cancelled" } } }
```

Both `waiting` and `called` visitors can be cancelled. They may have given up
before or after reaching the desk.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | |
| 400 | `visitorId is required` | |
| 400 | `invalid id format` | |
| 404 | `not found` | uuid-shaped visitor id that does not exist |
| 409 | `visitor has already been served` | A finished visit cannot be rewritten |
| 409 | `visitor is already cancelled` | |
| 403 | `not allowed` | Staff key |
| 500 | `something went wrong on our side` | |

---

### POST `/api/queue/speed`

Staff move the speed slider. 1 is normal, 2 is twice as fast, 0.5 is half speed.
Every estimate on every screen changes immediately.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `queueId` | string | yes | |
| `multiplier` | number | no | Between **0.25** and **4** |
| `speedMultiplier` | number | no | Same thing. Send one or the other |

Both names are accepted on purpose, so nobody has to be right about which one the
brief meant. If you send both, `multiplier` wins.

**Response — 200**

```json
{
  "ok": true,
  "data": {
    "queue": {
      "id": "uuid",
      "name": "Main Queue",
      "avgServiceSeconds": 300,
      "alertAtPosition": 3,
      "speedMultiplier": 2,
      "createdAt": "2026-10-03T09:00:00.000Z"
    }
  }
}
```

This is the **whole** queue row, six fields. `/list` only sends you four of them,
so do not assume the two responses have the same `queue` object.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `request body must be a JSON object` | |
| 400 | `queueId is required` | |
| 400 | `speedMultiplier must be a number between 0.25 and 4` | Out of range, not a number, or blank. Note the message says `speedMultiplier` even if you sent `multiplier` |
| 400 | `invalid id format` | |
| 404 | `not found` | uuid-shaped queue id that does not exist |
| 403 | `not allowed` | Staff key |
| 500 | `something went wrong on our side` | |

The range is checked twice — in the route and by a database constraint — so a bad
value can never break the estimate.

**An empty string is not zero.** If your number input is left blank you get a 400,
not a silent `0`. That matters because a silent `0` would be recorded as a real
measurement instead of falling back to the true value.

---

## How the wait estimate works

Worth knowing so the UI does not contradict it.

1. **People ahead** — everyone still in the line (`waiting` or `called`) with a
   lower ticket number. Your position is that plus one.
2. **How long a visit takes** — the average of the last 5 real visits, but only
   once there are at least **3** of them and none of them are zero seconds. Before
   that it uses the queue's own `avgServiceSeconds` (300 = 5 minutes by default).
3. **Speed** — the estimate is divided by `speedMultiplier`. Staff moving the slider
   changes every estimate immediately.
4. **The window** — the middle number, then 0.8x to 1.2x of it, rounded up. So 3
   people at 5 minutes each gives `12 to 18 minutes`, never a single number.
5. **`shouldAlert`** — true when `peopleAhead` is **3 or fewer**, not when the wait
   is short. It is about how close you are in line, not how many minutes you have.

---

## Live updates

Supabase Realtime is switched on for the `visitors` and `queues` tables. Subscribe
with the **anon** key — the read policies already allow it.

```js
const channel = supabase
  .channel("queue")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "visitors" },
    refetchList
  )
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "queues" },
    refetchList
  )
  .subscribe();
```

**A Realtime event tells you something changed. It does not tell you what the new
state is.** The simplest correct build is to refetch `/list` on any event. Do not
try to reconstruct the list from the payload — you will get the ordering wrong the
first time somebody joins while somebody else is being served.

Update and delete events carry the old row as well as the new one, so you can read
`old.status` if you really need to. You almost certainly do not.

**Staff screen** — refetch `/list`. Watching `visitors` catches joins, calls, serves
and cancels. Watching `queues` catches the speed slider moving.

**Visitor screen** — refetch `/status` on a `visitors` event for that visitor, and
on any `queues` event, because the speed slider changes the estimate without
touching any visitor row.

**Polling still works on its own** if Realtime gives trouble. 5 seconds for both
`/status` and `/list`.

---

## Demo mode

Two knobs exist so the demo can be fast without waiting for real time to pass.

### The speed slider — `POST /api/queue/speed`, range 0.25 to 4

One slider for the whole queue, on the staff screen. `1` is normal, `2` halves every
wait, `0.5` doubles it, `4` quarters it. Anything outside 0.25 to 4 is rejected with
a 400.

This is the good knob to demo with, because it moves every number on every screen
at once and needs no fake data.

### `simulatedSeconds` on `/api/queue/done`

Lets staff say "pretend that visit took 2 minutes" instead of waiting two real
minutes. Only a whole number of 0 or more is used; anything else silently falls back
to real timing, so leaving the field empty is safe.

`simulated: true` in the response tells you the duration was faked. The event is
still recorded in the real table, which means it feeds the moving average from step 2
above and does move the numbers.

**Note for your dashboard:** `avgServiceMinutes` in `stats` comes from these recorded
events, so demo visits do inflate it. `avgWaitMinutes` is measured from
`joined_at` to `served_at` and is not affected by `simulatedSeconds`.

---

## Environment variables

These are the names, for your `.env.local`. Ask Ammar for the values — do not guess
them and do not commit them.

| Name | Where it can be used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser **and** server. Safe to ship to the client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser **and** server. Safe to ship to the client |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only. Never in the browser, ever** |
| `GROQ_API_KEY` | **Server only. Never in the browser, ever** |
| `GROQ_MODEL` | **Server only.** Which model writes the messages |
| `STAFF_KEY` | **Server only.** Optional — see below |

**Anything without the `NEXT_PUBLIC_` prefix stays on the server.** Next.js only
exposes `NEXT_PUBLIC_*` to browser JavaScript. The other four are read inside
server code and are never in a response body.

`SUPABASE_SERVICE_ROLE_KEY` is the dangerous one. It bypasses row level security
entirely, which means it can read and write every row. If it reaches the browser,
anyone can empty the queue. The database read policies are set up for the *anon*
key, which is safe, and that is the one your Realtime subscription should use.

If a key ever gets committed, `.env.local` is gitignored so it should not happen —
but if one does leak, rotate it in the Supabase dashboard rather than deleting the
commit.

---

## The optional staff key

You probably do not need to do anything about this. Read it so you do not build a
header for nothing.

`src/lib/auth.ts` checks an `x-staff-key` request header against the `STAFF_KEY`
environment variable. **But only if `STAFF_KEY` is set.**

**If `STAFF_KEY` is not in `.env.local`, the check is skipped entirely.** Every route
behaves exactly as it always has, the header is never read, and you send nothing.
That is the current default, so your existing calls work as they are.

**If it is set, send it on the five staff routes:**

| Route | Checked? |
|---|---|
| `POST /api/queue/next` | yes |
| `POST /api/queue/done` | yes |
| `POST /api/queue/cancel` | yes |
| `POST /api/queue/speed` | yes |
| `GET /api/queue/list` | yes |
| `POST /api/queue/join` | no — visitor route, never checked |
| `GET /api/queue/status` | no — visitor route, never checked |
| `POST /api/ai/message` | no — visitor route, never checked |

```js
fetch("/api/queue/next", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-staff-key": STAFF_KEY,
  },
  body: JSON.stringify({ queueId }),
});
```

A wrong or missing header gives you **403** with `{"ok": false, "error": "not
allowed"}`. The message deliberately says nothing about what was wrong or what was
expected, so there is nothing to learn from it — ask Ammar if you get one.

**Visitor routes are never checked.** A visitor has no secret to present, and
checking them would only get in the way.

**Should you build the header now?** It is five lines and costs nothing, and it
means the moment Ammar sets `STAFF_KEY` your staff screen keeps working. But if you
would rather not, do not — with the variable unset nothing checks it.

**When to set `STAFF_KEY`:** the moment the app is reachable from anywhere other
than localhost. Every route uses the service role key on the server, which bypasses
row level security, so with no key set anyone who can reach the server can call
`/api/queue/next` and empty the queue. On localhost that is a demo, not a hole.

---

## What the public key can and cannot read

Worth knowing, because your Realtime subscription depends on it.

The public (`anon`) key ships in your browser bundle. That is how Supabase is
designed to work, and it is safe **as long as the database decides what it can
see.** Row level security is that decision, and it is set in
`supabase/migrations/001_init.sql`.

**The anon key can read:**

| Table | Why |
|---|---|
| `queues` | Your Realtime subscription needs it |
| `visitors` | Your Realtime subscription needs it |
| `service_events` | Harmless averages, no visitor detail |

**The anon key cannot read:**

| Table | Why |
|---|---|
| `visitor_phones` | No read policy exists, so every query is refused |

**The anon key can write nothing anywhere.** There are no insert, update or
delete policies on any table. Every write goes through our server.

So `visitors` is deliberately public — you need it, and it holds nothing
sensitive. `visitor_phones` is closed. If you ever find yourself wanting to read
a phone number from the browser directly, that is the signal something is wrong:
do it through `/api/queue/list` like the staff screen does, and if you genuinely
need it somewhere new, ask Ammar and Asad first.

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
  -d '{"queueId":"<queueId>","multiplier":2}'

# 7. a friendly sentence, both shapes
curl -X POST localhost:3000/api/ai/message -H "Content-Type: application/json" \
  -d '{"position":3,"minMinutes":12,"maxMinutes":18,"shouldAlert":true}'

curl -X POST localhost:3000/api/ai/message -H "Content-Type: application/json" \
  -d '{"visitorId":"<visitorId>","type":"alert"}'
```

**Getting a `queueId`** — run the SQL in `supabase/migrations/001_init.sql`. It
creates one queue called "Main Queue" with four visitors already in it, and it is
safe to run twice. Then:

```sql
select id, name from public.queues;
```

**These will all return 500 until `.env.local` has real Supabase keys.** That is the
missing-keys error, not a broken route.