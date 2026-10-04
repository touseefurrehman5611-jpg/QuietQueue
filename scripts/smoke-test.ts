/**
 * QuietQueue smoke test.
 *
 *   node scripts/smoke-test.ts [queueId]
 *
 * Imports NOTHING from src/. Node v24 strips the TypeScript types on its own
 * (`node src/lib/prediction.ts` already works in this repo), but the "@/*" path
 * alias only resolves inside Next, so a script living outside src/ has to talk
 * to the running dev server over plain HTTP.
 *
 * Writes real rows into the queue you point it at. It cancels the visitors it
 * created on the way out, but service events it recorded are permanent, so
 * point this at a scratch queue rather than the one you demo from.
 */

const BASE = (process.env.SMOKE_URL || "http://localhost:3000").replace(/\/+$/, "");
const QUEUE_ID = process.argv[2] || process.env.SMOKE_QUEUE_ID;

// Staff routes (list/next/done/cancel/speed) only check this header when
// STAFF_KEY is set on the server. Send it if we know it, stay quiet if not.
const STAFF_KEY = process.env.SMOKE_STAFF_KEY;

type Json = Record<string, unknown>;
type Reply = { status: number; body: { ok: boolean; data?: Json; error?: string; raw?: string } };

async function api(path: string, init: RequestInit = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (STAFF_KEY) headers["x-staff-key"] = STAFF_KEY;

  const res = await fetch(BASE + path, { ...init, headers });
  const text = await res.text();
  let body: Reply["body"];
  try {
    body = text ? JSON.parse(text) : { ok: false };
  } catch {
    body = { ok: false, raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function post(path: string, payload: unknown, rawBody?: string): Promise<Reply> {
  return api(path, { method: "POST", body: rawBody ?? JSON.stringify(payload) });
}

// Every check prints one line. The reason is always built at the point of the
// call so it can name the values that actually came back.
let passed = 0;
let failed = 0;

function report(check: string, ok: boolean, reason: string): void {
  if (ok) {
    passed++;
    console.log(`PASS [${check}] ${reason}`);
  } else {
    failed++;
    console.log(`FAIL [${check}] ${reason}`);
  }
}

function die(message: string, ...hints: string[]): never {
  console.error(`smoke-test: ${message}`);
  for (const hint of hints) console.error(`  ${hint}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

const NO_QUEUE_ID = [
  "No queueId given.",
  "",
  "  Usage:  node scripts/smoke-test.ts <queueId>",
  "      or: SMOKE_QUEUE_ID=<uuid> node scripts/smoke-test.ts",
  "",
  "To get one, run this in the Supabase SQL editor (or psql):",
  "",
  "  select id, name from public.queues;",
  "",
  "Other env vars:",
  "  SMOKE_URL          defaults to http://localhost:3000",
  "  SMOKE_STAFF_KEY    send as x-staff-key if the server sets STAFF_KEY",
].join("\n");

if (!QUEUE_ID) die(NO_QUEUE_ID);

// Rebound so the type is `string` inside the closures below.
const QID: string = QUEUE_ID;

// This test talks to a real dev server and a real database, so it can only run
// once both are up. The preflight below catches a missing server with a decent
// message, but "connection refused" is genuinely ambiguous on a first run: it
// looks the same whether Next is not running or Supabase is unreachable. Saying
// so up front saves the reader from assuming the script itself is broken.
console.log(
  `# smoke test needs a running dev server at ${BASE} and real Supabase keys in .env.local.`,
);

async function main(): Promise<void> {
  // ---- preflight: is the server up, is it configured, is the queue real? ----

  let probe: Reply;
  try {
    probe = await api(`/api/queue/list?queueId=${encodeURIComponent(QID)}`);
  } catch (error) {
    die(
      `cannot reach ${BASE} (${error instanceof Error ? error.message : String(error)}).`,
      "Is the dev server running?   npm run dev",
      "There is no .env.local in this repo yet. Without it Next has no",
      "SUPABASE_SERVICE_ROLE_KEY, so every database route answers 500 with",
      "\"something went wrong on our side\". Copy .env.example to .env.local,",
      "fill in the Supabase values, and run the SQL in supabase/ first.",
    );
  }

  if (probe.status === 403) {
    die(
      `the server has STAFF_KEY set and rejected our request: ${probe.body.error}`,
      "Set SMOKE_STAFF_KEY to the same value and re-run:",
      "  SMOKE_STAFF_KEY=<same value as STAFF_KEY> node scripts/smoke-test.ts " + QID,
    );
  }

  if (!probe.body.ok) {
    die(
      `queue ${QID} did not load (HTTP ${probe.status}: ${probe.body.error}).`,
      "Check the id with:  select id, name from public.queues;",
      "A 500 here means the database is not reachable or the migration has not been run.",
    );
  }

  const alertAtPosition = Number((probe.body.data?.queue as Json)?.alertAtPosition ?? 3);
  console.log(`# ${BASE}  queue=${QID}  alertAtPosition=${alertAtPosition}`);
  console.log(`# visitors created by this run are cancelled again at the end\n`);

  const created: string[] = [];
  const keep = (id: string) => void created.push(id);

  async function join(name: string): Promise<Json> {
    const res = await post("/api/queue/join", { queueId: QID, name });
    if (!res.body.ok) throw new Error(`join failed for ${name}: ${res.body.error}`);
    const data = res.body.data as Json;
    keep(data.visitorId as string);
    return data;
  }

  const ticketsOf = (rows: Json[]) => rows.map((r) => Number(r.ticketNo)).sort((a, b) => a - b);
  const ascendingDistinct = (nums: number[]) =>
    nums.every((n, i) => (i === 0 ? true : n > nums[i - 1]!)) && new Set(nums).size === nums.length;

  // ---- 1. five sequential joins -------------------------------------------

  const seq: Json[] = [];
  for (let i = 1; i <= 5; i++) seq.push(await join(`smoke-seq-${i}`));
  const seqTickets = ticketsOf(seq);

  report(
    "1 join x5",
    ascendingDistinct(seqTickets),
    `tickets ${seqTickets.join(",")} are distinct and ascending` +
      (seqTickets[0] === 1 ? " (started at 1)" : " (queue was not empty, so not 1..5)"),
  );

  // ---- 2. five concurrent joins (the createVisitor race) -------------------

  // createVisitor reads the current max ticket and then inserts, as two steps.
  // Five requests in the same tick is the only way to make those two steps
  // collide, so this is the check that actually exercises the fix.
  const conc = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => join(`smoke-conc-${i}`).catch((e) => ({ failed: String(e) }))),
  );
  const concOk = conc.filter((r) => !("failed" in r)) as Json[];
  const concTickets = ticketsOf(concOk);
  const concDistinct = new Set(concTickets).size === concTickets.length;
  const concNumbers = conc
    .map((r, i) => ("failed" in r ? `join${i + 1}=ERROR` : `#${(r as Json).ticketNo}`))
    .join(" ");

  report(
    "2 join x5 concurrent",
    concOk.length === 5 && concDistinct,
    `tickets [${concNumbers}] -> expected 5 distinct, got ${new Set(concTickets).size} distinct of ${concOk.length}`,
  );

  // ---- 3. next returns the lowest waiting ticket --------------------------

  const beforeNext = await api(`/api/queue/list?queueId=${encodeURIComponent(QID)}`);
  const waitingBefore = ((beforeNext.body.data as Json)?.waiting as Json[]) ?? [];
  const lowestWaiting = Math.min(...waitingBefore.map((v) => Number(v.ticketNo)));
  const nextRes = await post("/api/queue/next", { queueId: QID });
  const called = (nextRes.body.data as Json)?.visitor as Json | undefined;
  const calledTicket = Number(called?.ticketNo);

  report(
    "3 next",
    Boolean(called) && calledTicket === lowestWaiting,
    `called ticket ${calledTicket}, expected lowest waiting ${lowestWaiting}` +
      ` (${waitingBefore.length} waiting)`,
  );

  // ---- 4. done with simulatedSeconds --------------------------------------

  const servedBefore = Number(
    ((beforeNext.body.data as Json)?.stats as Json)?.servedCount ?? 0,
  );
  const doneRes = await post("/api/queue/done", {
    visitorId: called?.id,
    simulatedSeconds: 120,
  });
  const doneData = doneRes.body.data as Json | undefined;
  const duration = Number(doneData?.durationSeconds);
  const servedAfter = Number((doneData?.stats as Json)?.servedCount ?? -1);

  report(
    "4 done simulatedSeconds",
    duration === 120 && servedAfter === servedBefore + 1,
    `durationSeconds=${duration} (expected 120), simulated=${doneData?.simulated}, ` +
      `stats.servedCount ${servedBefore} -> ${servedAfter} (expected ${servedBefore + 1})`,
  );

  // ---- 5. speed 2 then 0.5 moves the wait window --------------------------

  // The deepest waiting visitor: most people ahead, so the window is wide
  // enough that the rounding in prediction.ts cannot hide a change.
  async function listWaiting(): Promise<Json[]> {
    const res = await api(`/api/queue/list?queueId=${encodeURIComponent(QID)}`);
    return ((res.body.data as Json)?.waiting as Json[]) ?? [];
  }

  async function setSpeed(multiplier: number): Promise<Reply> {
    return post("/api/queue/speed", { queueId: QID, multiplier });
  }

  type StatusBody = {
    status: string;
    position: number | null;
    maxMinutes: number | null;
    shouldAlert: boolean;
    alerted: boolean;
  };

  async function status(visitorId: string): Promise<StatusBody> {
    const res = await api(`/api/queue/status?visitorId=${encodeURIComponent(visitorId)}`);
    return (res.body.data ?? {}) as StatusBody;
  }

  async function deepVisitor(): Promise<Json | undefined> {
    const waiting = await listWaiting();
    return waiting.reduce<Json | undefined>(
      (deepest, v) => (deepest === undefined || Number(v.ticketNo) > Number(deepest.ticketNo) ? v : deepest),
      undefined,
    );
  }

  const deep = await deepVisitor();
  const deepId = String(deep?.id ?? "");

  await setSpeed(2);
  const fast = await status(deepId);
  await setSpeed(0.5);
  const slow = await status(deepId);
  await setSpeed(1); // leave the queue as we found it

  const fastMax = Number(fast.maxMinutes ?? 0);
  const slowMax = Number(slow.maxMinutes ?? 0);

  report(
    "5 speed 2 -> 0.5",
    fastMax > 0 && slowMax > fastMax,
    `ticket ${deep?.ticketNo} (position ${fast.position}): maxMinutes ${fastMax} at speed 2 -> ` +
      `${slowMax} at speed 0.5` +
      (fastMax > 0 ? "" : " - window was 0 at speed 2, nothing to compare"),
  );

  // ---- 6. an alert fires once and only once -------------------------------

  // Refill the line first: the alert window is "within N people of the front",
  // so reaching the deep visitor takes one `next` per person in between.
  for (let i = 1; i <= 4; i++) await join(`smoke-alert-${i}`);

  let alerted = false;
  let sawFalseAfterTrue = false;
  let rounds = 0;
  let wasAlerted = false;

  // Every poll of the deep visitor, before and after the flip.
  const poll = async (): Promise<StatusBody> => {
    const s = await status(deepId);
    if (s.alerted) alerted = true;
    else if (wasAlerted) sawFalseAfterTrue = true;
    wasAlerted = s.alerted;
    rounds++;
    return s;
  };

  // Walking `next` up the line is what pushes the deep visitor into the window.
  //
  // Each `next` has to be paired with a `done`, exactly like a real desk. A
  // visitor left in `called` still counts as someone ahead of you (alerts.ts
  // counts the whole active list), so without the `done` everyone we call just
  // piles up at the front, the deep visitor never actually reaches the front,
  // and the alert window is never entered -- the check would prove nothing.
  for (let i = 0; i < 14 && !alerted; i++) {
    const before = await listWaiting();
    if (before.length <= 1) break;
    const n = await post("/api/queue/next", { queueId: QID });
    const calledId = String((((n.body.data as Json)?.visitor) as Json | undefined)?.id ?? "");
    if (calledId) {
      await post("/api/queue/done", { queueId: QID, visitorId: calledId, simulatedSeconds: 60 });
    }
    await poll();
  }

  // Poll again. `alerted` is the one flag that must never go back to false --
  // that column is the whole "never alert twice" guarantee, and it only ever
  // flips false -> true.
  const firstSeen = await status(deepId);
  const after: StatusBody[] = [];
  for (let i = 0; i < 3; i++) after.push(await poll());

  const stable = after.every(
    (s) => s.alerted === true && s.shouldAlert === firstSeen.shouldAlert,
  );

  report(
    "6 alert once",
    alerted && !sawFalseAfterTrue && stable,
    alerted
      ? `alerted on round ${rounds}, then held true across ${after.length} more polls ` +
          `(shouldAlert=${firstSeen.shouldAlert}, position=${firstSeen.position})` +
          (sawFalseAfterTrue ? " - WENT BACK TO false" : "")
      : `never alerted after ${rounds} polls across 14 'next' calls - the check proved nothing`,
  );

  // ---- 7. cancel shifts everyone behind up one place ----------------------

  const waiting = await listWaiting();
  if (waiting.length < 3) {
    report("7 cancel", false, `only ${waiting.length} visitors left waiting, need 3 to test the shift`);
  } else {
    const target = waiting[1] as Json;
    const behind = waiting.slice(2).map((v) => ({ id: String(v.id), pos: Number(v.position) }));
    const cancelRes = await post("/api/queue/cancel", { visitorId: target.id });
    const after = await listWaiting();
    const posOf = (id: string) => {
      const found = after.find((v) => String(v.id) === id);
      return found ? Number(found.position) : -1;
    };
    const moves = behind.map((b) => ({ ...b, now: posOf(b.id) }));
    const allUpOne = moves.every((m) => m.now === m.pos - 1);

    report(
      "7 cancel",
      cancelRes.body.ok && allUpOne,
      `cancelled ticket ${target.ticketNo} (HTTP ${cancelRes.status}); ` +
        (moves.length === 0
          ? "nobody behind to check"
          : `positions behind moved ${moves.map((m) => `${m.pos}->${m.now}`).join(" ")}, ` +
            `expected each one lower by 1`),
    );
  }

  // ---- 8. bad input is 4xx, never 500 -------------------------------------

  const longName = "x".repeat(200);
  const badCases: [string, () => Promise<Reply>][] = [
    ["empty name", () => post("/api/queue/join", { queueId: QID, name: "" })],
    ["200-char name", () => post("/api/queue/join", { queueId: QID, name: longName })],
    // queueId is deliberately NOT required: resolveQueueId() picks the default
    // queue, which is what the merged frontend sends. Asserting a 400 here
    // would pin a contract we deliberately removed. Covered positively in
    // verify-live C2, which joins with no queueId at all.
    ["malformed JSON", () => post("/api/queue/join", null, '{"queueId": ')],
    ["unknown visitorId", () => api(`/api/queue/status?visitorId=${crypto.randomUUID()}`)],
    // The speed range is 0.25 to 4 inclusive. Anything outside is a 400, which
    // is what stops a typo making the estimate divide by zero.
    ["speed 0.2 (below range)", () => post("/api/queue/speed", { queueId: QID, multiplier: 0.2 })],
    ["speed 5 (above range)", () => post("/api/queue/speed", { queueId: QID, multiplier: 5 })],
    ["speed blank string", () => post("/api/queue/speed", { queueId: QID, multiplier: "" })],
    // done and cancel must refuse a visitor who is already finished, rather than
    // silently rewriting history the average wait is built from.
    ["done a served visitor", () => post("/api/queue/done", { visitorId: String(called?.id ?? "") })],
  ];

  for (const [label, run] of badCases) {
    let res: Reply;
    try {
      res = await run();
    } catch (error) {
      report(`8 bad input: ${label}`, false, `request threw: ${String(error)}`);
      continue;
    }
    const err = res.body.error ?? res.body.raw ?? "(no error string)";
    report(
      `8 bad input: ${label}`,
      res.status >= 400 && res.status < 500,
      `HTTP ${res.status} "${err}"` + (res.status >= 500 ? "  <- this is a 500" : ""),
    );
  }

  // ---- teardown ------------------------------------------------------------

  for (const id of created) {
    await post("/api/queue/cancel", { visitorId: id }).catch(() => {});
  }
  console.log(`\n# cancelled ${created.length} visitors created by this run`);

  console.log(
    `\n${failed === 0 ? "OK" : "FAILED"}: ${passed} passed, ${failed} failed, ${created.length} visitors cleaned up`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`smoke-test: unexpected crash: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});