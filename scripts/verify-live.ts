// Live verification for the three things the smoke test does not cover.
//
//   npm run dev            (in another terminal)
//   node scripts/verify-live.ts
//
// smoke-test.ts owns the lifecycle: joins, next, done, speed, alerts, cancel,
// bad input. This file owns the three questions that survive that suite:
//
//   A. maths  - does the moving average actually move the live estimate?
//   B. safety - can the public anon key read a phone number? is STAFF_KEY real?
//   C. wiring - do the merged pages' API calls return what the pages read?
//
// Every call goes through src/lib/api.ts, the same helper the React components
// use, so an envelope that drifts breaks this script too. That file imports
// nothing, so node's native type stripping can load it directly -- no bundler,
// no tsx, no path alias.
//
// Writes real rows and cleans up after itself. Point it at a scratch queue.

import { existsSync } from "node:fs";

// Deliberately NOT importing node:path's join: this file defines its own
// join() helper for adding a visitor to a queue, and the shadowing made every
// path call resolve to the wrong function.

// npm always runs a script from the package root, so cwd is the project root.
const envPath = `${process.cwd()}/.env.local`;
if (existsSync(envPath)) process.loadEnvFile(envPath);

// src/lib/api.ts is the same helper the React components use, so importing it
// here tests the real unwrapping path rather than a copy of it. It has no
// imports of its own, which is what lets node load it directly here.
const api = (await import("../src/lib/api.ts")) as unknown as {
  apiGet: <T>(path: string) => Promise<T>;
  apiPost: <T>(path: string, payload?: unknown) => Promise<T>;
  statusOf: (error: unknown) => number | undefined;
};

const { apiGet, apiPost, statusOf } = api;

const BASE = (process.env.SMOKE_URL || "http://localhost:3000").replace(/\/+$/, "");

type Json = Record<string, unknown>;
type Row = Json & { id: string };

let passed = 0;
let failed = 0;
const created: string[] = [];

function report(label: string, ok: boolean, detail: string): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label} -- ${detail}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label} -- ${detail}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const post = <T>(p: string, b?: unknown) => apiPost<T>(`${BASE}${p}`, b);
const get = <T>(p: string) => apiGet<T>(`${BASE}${p}`);

// A visitor we own, cancelled on the way out so the queue is left as found.
async function join(name: string, phone?: string): Promise<{ visitorId: string; ticketNo: number }> {
  const v = await post<{ visitorId: string; ticketNo: number }>("/api/queue/join", { name, phone });
  created.push(v.visitorId);
  return v;
}

async function cleanup(): Promise<void> {
  for (const id of created) await post("/api/queue/cancel", { visitorId: id }).catch(() => {});
  if (created.length > 0) console.log(`\n# cancelled ${created.length} visitors created by this run`);
}

// ---------------------------------------------------------------------------

console.log(`# verify-live against ${BASE}`);
console.log("# needs a running dev server and real Supabase keys in .env.local");

let queueId = "";
let queueSpeed = 1;

try {
  const probe = await get<{ queue: { id: string; name: string; speedMultiplier?: number } }>("/api/queue/list");
  queueId = probe.queue.id;
  queueSpeed = probe.queue.speedMultiplier ?? 1;
  console.log(`# queue "${probe.queue.name}" (${queueId}) speed=${queueSpeed}\n`);
} catch (error) {
  console.error(`\nverify-live: cannot reach ${BASE}: ${error instanceof Error ? error.message : String(error)}`);
  console.error("  Is the dev server running?   npm run dev");
  console.error("  Are the Supabase keys in quietqueue/.env.local (not the parent folder)?");
  process.exit(1);
}

// An unguarded 4xx anywhere below would otherwise kill the run with a raw stack
// trace and skip cleanup, leaving visitors in the queue. Turn it into a FAIL.
process.on("unhandledRejection", (reason) => {
  report("verify-live aborted", false, `unhandled: ${reason instanceof Error ? reason.message : String(reason)}`);
  process.exit(1);
});

// ===========================================================================
section("A. maths and prediction integrity");
// ===========================================================================

// The moving average is the one piece of logic that is NOT covered by any
// offline self-check, because offline there are no service_events to average.
//
// Setup: four visitors, then finish three of them with durations that average
// to 180s (120+180+240)/3. The queue is seeded at avg_service_seconds = 300, so
// if the average does not take over, the fourth person's estimate says 300s.
// With it, it says 180s. 180 is far enough from 300 that rounding cannot hide a
// failure either way.
section("A1. moving average over the last 5 service_events");

// The moving average is the one piece of logic that is NOT covered by any
// offline self-check, because offline there are no service_events to average.
//
// How this builds a discriminating test:
//
//   1. Record three service events of known length (120, 180, 240 -> mean 180).
//      Whoever `next` hands us gets them; which visitor that is does not
//      matter, because the average is built from service_events, not visitors.
//   2. Join some fillers, then one observer. They take the highest ticket
//      numbers, so EVERY still-waiting visitor is ahead of the observer and
//      peopleAhead is guaranteed to be non-zero.
//   3. Read /status and compare against both candidate averages.
//
// The comparison in step 3 is the part that matters. 180s and the 300s seed
// predict DIFFERENT windows once peopleAhead is big enough, so the assertion
// can only pass if the code really used the moving average. If the two
// candidates happen to round to the same number the test is inconclusive, and
// this reports that rather than claiming a pass.
const AVG_SECONDS = 180;
const DURATIONS = [120, 180, 240];

// A scratch queue starts EMPTY, and /next on an empty queue is a 404. Seed the
// three history visitors up front -- who gets finished does not matter, because
// the average is built from service_events rather than from visitors.
for (let i = 0; i < DURATIONS.length; i++) await join(`avg-history-${i + 1}`);

let historyBuilt = true;
for (const seconds of DURATIONS) {
  await post("/api/queue/next", {});
  // `next` returns the visitor it called; done needs that id, not a guess.
  const called = await get<{ waiting: Row[]; called: Row[] }>("/api/queue/list");
  const atDesk = called.called.sort((a, b) => String(b.calledAt ?? "").localeCompare(String(a.calledAt ?? "")))[0];
  if (!atDesk) {
    report("A1 build a service history", false, "nothing was at the desk after /next");
    historyBuilt = false;
    break;
  }
  await post("/api/queue/done", { visitorId: String(atDesk.id), simulatedSeconds: seconds });
}

// Fillers first so the observer has a real queue depth ahead of them.
for (let i = 0; i < 3; i++) await join(`avg-filler-${i + 1}`);
const observer = await join("avg-observer");

const afterThree = await get<{ peopleAhead: number; minMinutes: number; maxMinutes: number }>(
  `/api/queue/status?visitorId=${observer.visitorId}`,
);

// predict() divides by the queue's speed multiplier, so every expectation here
// has to divide by it too -- otherwise a queue left at 2x reports false FAILs.
const expectedWithAverage = Math.ceil((afterThree.peopleAhead * AVG_SECONDS) / 60 * 0.8 / queueSpeed);
const expectedWithSeed = Math.ceil((afterThree.peopleAhead * 300) / 60 * 0.8 / queueSpeed);
const discriminating = expectedWithAverage !== expectedWithSeed;

if (historyBuilt) {
  report(
    "A1 estimate reflects the 180s moving average, not the 300s seed",
    discriminating && afterThree.minMinutes === expectedWithAverage,
    `peopleAhead=${afterThree.peopleAhead}, got minMinutes=${afterThree.minMinutes}, ` +
      `180s average predicts ${expectedWithAverage}, stale 300s seed predicts ${expectedWithSeed}` +
      (discriminating ? "" : "  <- INCONCLUSIVE: both averages round to the same number, so this proves nothing"),
  );
}

// A 4th event that moves the average again: last four are 120,180,240,600 ->
// 1140/4 = 285. If the code cached the first average instead of recomputing,
// this is where it would show.
await post("/api/queue/next", {});
const desk = await get<{ called: Row[] }>("/api/queue/list");
const newest = desk.called.sort((a, b) => String(b.calledAt ?? "").localeCompare(String(a.calledAt ?? "")))[0];
if (!newest) {
  report("A2 fourth service event recorded", false, "nothing was at the desk after /next, so no event was written");
} else {
  await post("/api/queue/done", { visitorId: String(newest.id), simulatedSeconds: 600 });

  const second = await join("avg-observer-2");
  const afterFour = await get<{ peopleAhead: number; minMinutes: number }>(
    `/api/queue/status?visitorId=${second.visitorId}`,
  );
  const MOVED_AVERAGE = (120 + 180 + 240 + 600) / 4; // 285
  const expectedMoved = Math.ceil((afterFour.peopleAhead * MOVED_AVERAGE) / 60 * 0.8 / queueSpeed);
  const movedDiscriminates = expectedMoved !== Math.ceil((afterFour.peopleAhead * 180) / 60 * 0.8 / queueSpeed);

  report(
    "A2 estimate follows the average when it moves again",
    movedDiscriminates && afterFour.minMinutes === expectedMoved,
    `after a 4th visit at 600s the average is ${MOVED_AVERAGE}s, peopleAhead=${afterFour.peopleAhead}, ` +
      `got minMinutes=${afterFour.minMinutes}, expected ${expectedMoved}` +
      (movedDiscriminates ? "" : "  <- INCONCLUSIVE"),
  );
}

// Position 1 must be a strict 0-0 window. Math.ceil(0 * 0.8) is 0, and the
// floor is what stops a next-in-line visitor being promised "1-2 min".
section("A3. first in line waits exactly 0 to 0 minutes");

const front = await join("front-of-line");
// Cancel everyone ahead of them so they really are position 1. predictForVisitor
// counts `called` as well as `waiting`, so both lists have to be cleared or a
// visitor left at the desk still counts as people-ahead.
const line = await get<{ waiting: Row[]; called: Row[] }>("/api/queue/list");
const ahead = [...line.called, ...line.waiting].filter((v) => Number(v.ticketNo) < front.ticketNo);
for (const v of ahead) await post("/api/queue/cancel", { visitorId: String(v.id) }).catch(() => {});

const firstInLine = await get<{ position: number; peopleAhead: number; minMinutes: number; maxMinutes: number }>(
  `/api/queue/status?visitorId=${front.visitorId}`,
);

report(
  "A3 position 1 gives a strict 0-0 window",
  firstInLine.position === 1 && firstInLine.minMinutes === 0 && firstInLine.maxMinutes === 0,
  `position=${firstInLine.position}, peopleAhead=${firstInLine.peopleAhead}, ` +
    `window=${firstInLine.minMinutes}-${firstInLine.maxMinutes} min`,
);

// Alert fires once. This is the guarantee the `alerted` column exists for.
section("A4. the alert flag flips false -> true and never back");

const watched = await join("alert-watch");
let sawTrue = false;
let wentBackToFalse = false;
let previously = false;

for (let i = 0; i < 12 && !sawTrue; i++) {
  await post("/api/queue/next", {});
  const s = await get<{ alerted: boolean; shouldAlert: boolean; position: number }>(
    `/api/queue/status?visitorId=${watched.visitorId}`,
  );
  if (s.alerted) sawTrue = true;
  else if (previously) wentBackToFalse = true;
  previously = s.alerted;
  if (i > 0 && s.position === 0) break; // served, nothing left to alert on
}

// Poll three more times after the flip.
for (let i = 0; i < 3; i++) {
  const s = await get<{ alerted: boolean }>(`/api/queue/status?visitorId=${watched.visitorId}`);
  if (!s.alerted) wentBackToFalse = true;
}

report(
  "A4 alert fires once and holds",
  sawTrue && !wentBackToFalse,
  sawTrue
    ? "alerted became true and stayed true across 3 further polls"
    : "never fired, so this check proved nothing -- the visitor never reached the window",
);

// ===========================================================================
section("B. security and privacy");
// ===========================================================================

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The proof, made directly against PostgREST with the public key.
//
// Subtle point worth stating: RLS with NO select policy does not return an
// error. It returns 200 with an empty array. So "it came back empty" is only
// evidence if we also prove the request actually worked -- hence the control
// query against `visitors` in the very next check.
section("B1. the public anon key cannot read visitor_phones");

if (!SB_URL || !ANON) {
  report("B1 anon cannot read visitor_phones", false, "NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set, cannot prove it");
} else {
  // NOTE: the full body is returned and parsed in full. An earlier version
  // sliced to 200 chars BEFORE JSON.parse, which meant a genuinely leaking
  // visitor_phones response was truncated mid-array, failed to parse, and
  // left `rows` empty -- so the privacy check reported PASS on a real leak.
  const anonGet = async (path: string) => {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const text = await res.text();
    let rows: unknown[] = [];
    try { rows = JSON.parse(text); } catch { /* not json */ }
    if (!Array.isArray(rows)) rows = [];
    return { status: res.status, text, rows };
  };

  // NEVER print the body of a visitor_phones response. If RLS were open that
  // body IS people's phone numbers, and a security check must not be the thing
  // that leaks them into a terminal or a CI log. Status and row count are the
  // only facts this check needs.
  const phones = await anonGet("visitor_phones?select=*&limit=5");
  report(
    "B1 anon cannot read visitor_phones",
    phones.status === 200 && phones.rows.length === 0,
    `HTTP ${phones.status}, ${phones.rows.length} rows returned (body not printed) -- ` +
      (phones.rows.length === 0
        ? "zero rows, which is what an RLS policy with no SELECT looks like"
        : `${phones.rows.length} ROW(S) LEAKED -- phone numbers are readable by the public key`),
  );

  // The control. Without this, B1 passes for the wrong reason (wrong URL, no
  // network) rather than because RLS is doing its job.
  const visitors = await anonGet("visitors?select=id&limit=5");
  report(
    "B2 control: anon CAN read visitors (so B1 is meaningful)",
    visitors.status === 200 && visitors.rows.length > 0,
    `HTTP ${visitors.status}, ${visitors.rows.length} rows -- ` +
      "realtime needs this, and it proves the request shape in B1 was valid",
  );

  // The control's other half: no phone column on the publicly readable table.
  // Same rule as B1: report the status, never the payload.
  const leak = await anonGet("visitors?select=phone&limit=1");
  report(
    "B3 anon cannot read a phone column on visitors",
    leak.status >= 400 || (leak.status === 200 && !leak.text.includes("phone")),
    `HTTP ${leak.status}, ${leak.rows.length} rows (body not printed) -- ` +
      `a 400 here means the column is genuinely gone`,
  );

  // Anonymous writes must be refused. Uses the REAL queue id: a bogus one
  // would fail on the foreign key instead, which would look like a refused
  // write even if the INSERT policy were wide open.
  const writeRes = await fetch(`${SB_URL}/rest/v1/visitors`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ name: "anon-write-probe", ticket_no: 999999, queue_id: queueId }),
  });
  report(
    "B4 anon cannot write to visitors",
    writeRes.status >= 400,
    `POST returned HTTP ${writeRes.status} -- ${writeRes.status >= 400 ? "refused" : "ANON CAN WRITE"}`,
  );
}

section("B5. STAFF_KEY gate");

// auth.ts fails OPEN when STAFF_KEY is unset, which is deliberate for a demo
// (the staff buttons send no header). So the honest statement is not "the gate
// passed" but "here is exactly what state the server is in".
if (!process.env.STAFF_KEY) {
  console.log("  SKIP  STAFF_KEY is not set -- staff routes are open by design (src/lib/auth.ts).");
  console.log("        This is the correct state for the demo. To prove the gate works, restart");
  console.log("        the server with STAFF_KEY set in .env.local and re-run this script.");
} else {
  const noKey = await fetch(`${BASE}/api/queue/list`, { headers: { "Content-Type": "application/json" } });
  const wrongKey = await fetch(`${BASE}/api/queue/list`, {
    headers: { "Content-Type": "application/json", "x-staff-key": "definitely-not-the-key" },
  });
  const rightKey = await fetch(`${BASE}/api/queue/list`, {
    headers: { "Content-Type": "application/json", "x-staff-key": process.env.STAFF_KEY },
  });

  report("B5 no header is refused", noKey.status === 403, `HTTP ${noKey.status} (want 403)`);
  report("B6 wrong header is refused", wrongKey.status === 403, `HTTP ${wrongKey.status} (want 403)`);
  report("B7 correct header is allowed", rightKey.status === 200, `HTTP ${rightKey.status} (want 200)`);

  const leakText = await wrongKey.text();
  report(
    "B8 the refusal says nothing useful to an attacker",
    !/staff|key|header|expect/i.test(leakText),
    `body: ${leakText.slice(0, 80)} -- must not name the header or the expected value`,
  );
}

// ===========================================================================
section("C. frontend-to-backend wiring");
// ===========================================================================

// The pages the merged UI serves. A 404 or 500 here is the failure that would
// show a judge a blank screen.
section("C1. every page responds");

// /not-found is the App Router boundary: Next serves it with HTTP 404 for any
// unmatched path, so 404 is the CORRECT status here, not a failure.
for (const [p, want] of [["/", 200], ["/staff", 200], ["/visitor", 200], ["/not-found", 404]] as [string, number][]) {
  const res = await fetch(`${BASE}${p}`, { redirect: "manual" });
  report(`C1 GET ${p}`, res.status === want, `HTTP ${res.status} (want ${want})`);
}

// The calls the pages actually make, in the exact shapes they send them.
section("C2. the calls the pages make");

const w = await join("wiring-probe", "03001234567");
report("C2 join returns visitorId + ticketNo", typeof w.visitorId === "string" && Number.isInteger(w.ticketNo),
  `visitorId=${w.visitorId.slice(0, 8)}..., ticketNo=${w.ticketNo}`);

// /api/queue/list with NO queueId -- exactly what the staff screen sends, and
// the case that would 400 before resolveQueueId existed.
const listRes = await get<{ waiting: Row[]; called: Row[]; stats: { servedCount: number; avgWaitMinutes: number | null }; queue: { name: string } }>("/api/queue/list");
report(
  "C3 /list with no queueId returns what the staff screen reads",
  Array.isArray(listRes.waiting) && Array.isArray(listRes.called) &&
    typeof listRes.stats.servedCount === "number" && typeof listRes.queue.name === "string",
  `waiting=${listRes.waiting.length}, called=${listRes.called.length}, served=${listRes.stats.servedCount}, queue="${listRes.queue.name}"`,
);

// The staff screen reads visitor.ticketNo and visitor.phone off these rows.
const firstRow = [...listRes.called, ...listRes.waiting][0] as Row | undefined;
report(
  "C4 staff rows expose ticketNo and phone (camelCase, not the column names)",
  firstRow !== undefined && typeof firstRow.ticketNo === "number" && "phone" in firstRow,
  firstRow
    // Presence only. The value is a phone number and this is a log.
    ? `row has ticketNo=${firstRow.ticketNo}, phone ${firstRow.phone == null ? "is null" : "is present"}`
    : "queue is empty, so this proves nothing",
);

// /api/queue/next with an EMPTY body -- the other call that used to 400.
let nextOk = false;
let nextDetail = "";
let calledId = "";
try {
  const n = await post<{ visitor: Row; message: string }>("/api/queue/next", {});
  nextOk = typeof n.visitor?.id === "string";
  if (nextOk) calledId = String(n.visitor.id);
  nextDetail = `called ticket ${(n.visitor as Row | undefined)?.ticketNo}`;
} catch (error) {
  nextDetail = `threw: ${error instanceof Error ? error.message : String(error)}`;
}
report("C5 /next with an empty body works", nextOk, nextDetail);

if (nextOk) {
  // The id MUST come from the /next response. `next` calls the LOWEST waiting
  // ticket, which is generally not the visitor this script joined last -- using
  // the wrong id makes /done return 409 "visitor is waiting, not called".
  const doneRes = await post<{ durationSeconds: number; simulated: boolean; stats: { servedCount: number } }>(
    "/api/queue/done", { visitorId: calledId, simulatedSeconds: 90 },
  );
  report(
    "C6 /done returns the duration it recorded",
    doneRes.durationSeconds === 90 && doneRes.simulated === true && typeof doneRes.stats.servedCount === "number",
    `durationSeconds=${doneRes.durationSeconds}, simulated=${doneRes.simulated}, servedCount=${doneRes.stats.servedCount}`,
  );
}

const simRes = await post<{ added: number; waiting: number }>("/api/demo/simulate", {});
report("C7 /demo/simulate fills the queue", simRes.added > 0, `added=${simRes.added}, waiting now=${simRes.waiting}`);

// The status page's own call, plus the fields it renders.
const st = await get<{ status: string; position: number | null; minMinutes: number | null; maxMinutes: number | null; message: string | null; shouldAlert: boolean; queueName: string }>(
  `/api/queue/status?visitorId=${created[created.length - 1]}`,
);
report(
  "C8 /status returns every field the status screen renders",
  "status" in st && "position" in st && "minMinutes" in st && "message" in st && "shouldAlert" in st,
  `status=${st.status}, position=${st.position}, window=${st.minMinutes}-${st.maxMinutes}, shouldAlert=${st.shouldAlert}, queue="${st.queueName}"`,
);

// A finished visitor's page must not 500 -- it is a real path a judge will hit.
const donePage = await fetch(`${BASE}/visitor/view?visitorId=${created[created.length - 1]}`);
report("C9 GET /visitor/view with a real id", donePage.status === 200, `HTTP ${donePage.status} (want 200)`);

// Bad input is a 4xx, never a 500. One representative case per boundary.
section("C10. bad input is 4xx, never 500");

for (const [label, run] of [
  ["empty name", () => post("/api/queue/join", { name: "" })],
  ["no name at all", () => post("/api/queue/join", {})],
  ["unknown visitorId", () => get("/api/queue/status?visitorId=00000000-0000-0000-0000-000000000000")],
  ["missing visitorId", () => get("/api/queue/status")],
  // queueId must be sent, or the route 400s on "queueId is required" and the
  // range check never actually runs.
  ["speed out of range", () => post("/api/queue/speed", { queueId, multiplier: 99 })],
] as [string, () => Promise<unknown>][]) {
  const status = await run().then(
    () => 200,
    (error: unknown) => statusOf(error) ?? 0,
  );
  report(`C10 ${label}`, status >= 400 && status < 500, `HTTP ${status}${status >= 500 ? "  <- THIS IS A 500" : ""}`);
}

// ---------------------------------------------------------------------------

await cleanup();

console.log(
  `\n${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed, ${created.length} visitors cleaned up`,
);
process.exit(failed === 0 ? 0 : 1);