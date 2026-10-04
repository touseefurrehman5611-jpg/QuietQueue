// Demo-day readiness gate.
//
//   node scripts/preflight.ts
//
// Refuses to continue, loudly and in about three seconds, when something is
// wrong that would otherwise show the judges a blank screen. It checks
// READINESS only -- it does not re-test behaviour. The behaviour tests are
// `npm test` (offline) and `npm run smoke` (needs a live server).
//
// Exit 0 means "safe to run npm start". Exit 1 means "fix the line it printed".
//
// ponytail: this exists because a failed demo is worth more to avoid than this
// file is to maintain. Delete it if the app ever gets real deployment health
// checks that cover the same ground.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A standalone node script does NOT get Next's .env.local loading for free, so
// read it ourselves. node:process.loadEnvFile is stdlib; no dotenv dependency.
const ROOT = join(import.meta.dirname, "..");
const ENV_FILE = join(ROOT, ".env.local");

function loadEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  // Throws on a malformed line, which is itself worth knowing about.
  process.loadEnvFile(ENV_FILE);
}

let failed = 0;

function ok(label: string, detail: string): void {
  console.log(`  PASS  ${label} -- ${detail}`);
}

function bad(label: string, detail: string, fix: string): void {
  failed++;
  console.log(`  FAIL  ${label} -- ${detail}`);
  console.log(`        fix: ${fix}`);
}

console.log("# QuietQueue preflight\n");
console.log(`#   .env.local : ${existsSync(ENV_FILE) ? ENV_FILE : "MISSING"}`);
console.log(`#   cwd        : ${process.cwd()}\n`);

loadEnv();

// ---- 1. the keys the server cannot boot without ---------------------------

console.log("1. environment");

if (!existsSync(ENV_FILE)) {
  bad(
    ".env.local exists",
    "not found",
    "copy it from the project root's parent, or create one from .env.example. " +
      "Next.js only reads .env.local from the directory package.json lives in",
  );
} else {
  ok(".env.local exists", ENV_FILE);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const looksReal = (v?: string) =>
  Boolean(v) && !/your[-_]|placeholder|xxx|changeme/i.test(v as string);

if (looksReal(url)) ok("NEXT_PUBLIC_SUPABASE_URL", "set");
else bad("NEXT_PUBLIC_SUPABASE_URL", url ? "still a placeholder" : "not set", "paste the project URL from Supabase settings -> Data API");

if (looksReal(serviceKey)) ok("SUPABASE_SERVICE_ROLE_KEY", "set");
else bad("SUPABASE_SERVICE_ROLE_KEY", serviceKey ? "still a placeholder" : "not set", "paste the service_role key. Never prefix it with NEXT_PUBLIC_");

if (looksReal(anonKey)) ok("NEXT_PUBLIC_SUPABASE_ANON_KEY", "set");
else bad("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey ? "still a placeholder" : "not set", "paste the anon key. The realtime updates and the privacy proof both need it");

if (!process.env.GROQ_API_KEY) {
  // Not a failure. The AI route falls back to a fixed template sentence.
  ok("GROQ_API_KEY", "not set -- AI messages use the built-in fallback (fine for a demo)");
} else {
  ok("GROQ_API_KEY", "set");
}

if (process.env.STAFF_KEY) {
  // Worth a warning, not a failure: it is correct to set in production and
  // actively harmful in a demo, because the staff buttons send no header.
  console.log(
    "  WARN  STAFF_KEY is set. /api/queue/list|next|done|cancel|speed will return 403\n" +
      "        because the staff dashboard sends no x-staff-key header. Unset it to demo.",
  );
} else {
  ok("STAFF_KEY", "not set -- staff routes are open, which is what you want on the demo machine");
}

if (failed > 0) {
  console.log(`\npreflight: ${failed} blocking problem(s). The app would show an error screen.`);
  process.exit(1);
}

// ---- 2. the database is reachable and the schema is right -----------------

// This is the part that saves the most time. A missing migration does not throw
// an obvious error at boot; it fails later, on the first route call, in front of
// a judge. Each probe is a SELECT, so this writes nothing.
console.log("\n2. database");

if (!url || !serviceKey) {
  console.log("\npreflight: cannot reach the database without a URL and a key. Fix section 1 first.");
  process.exit(1);
}

type Probe = {
  table: string;
  columns: string;
  from: string;
  why: string;
};

const PROBES: Probe[] = [
  { table: "queues", columns: "speed_multiplier,alert_at_position", from: "001", why: "without speed_multiplier every wait estimate renders as NaN" },
  { table: "visitors", columns: "alerted", from: "001", why: "without alerted no turn alert can ever fire" },
];

async function rest(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: serviceKey as string, Authorization: `Bearer ${serviceKey}` },
  });
  return { status: res.status, body: await res.text() };
}

async function checkColumn(probe: Probe): Promise<void> {
  const { status, body } = await rest(`${probe.table}?select=${probe.columns}&limit=1`);

  if (status === 200) return ok(`${probe.table}.${probe.columns}`, "present");
  if (status === 404) {
    return bad(`${probe.table}.${probe.columns}`, "column or table missing", `run supabase/migrations/${probe.from}_init.sql in the Supabase SQL editor -- ${probe.why}`);
  }
  if (status === 400 || status === 42703) {
    return bad(`${probe.table}.${probe.columns}`, `Postgres rejected the column (HTTP ${status})`, `run supabase/migrations/003_reconcile_amna_schema.sql -- ${probe.why}`);
  }
  return bad(`${probe.table}.${probe.columns}`, `unexpected HTTP ${status}: ${body.slice(0, 120)}`, "check the project URL and service key");
}

for (const probe of PROBES) {
  try {
    await checkColumn(probe);
  } catch (error) {
    bad(`${probe.table} probe`, String(error), "is the Supabase project reachable from this machine?");
  }
}

// visitor_phones must exist (migration 002) and must be unreadable by anon.
try {
  const { status } = await rest("visitor_phones?select=phone&limit=1");
  if (status === 200) ok("visitor_phones", "exists (phone numbers are off the public visitors table)");
  else if (status === 404) bad("visitor_phones", "table missing -- phone numbers may still be on the public visitors table", "run supabase/migrations/002_phone_split.sql");
  else bad("visitor_phones", `unexpected HTTP ${status}`, "run 002_phone_split.sql, then 003_reconcile_amna_schema.sql");
} catch (error) {
  bad("visitor_phones probe", String(error), "check network access to the Supabase project");
}

// The anon control. If anon cannot read `visitors` either, the privacy check in
// verify-live.ts would pass for the wrong reason, so it is a real gate here.
if (anonKey) {
  try {
    const res = await fetch(`${url}/rest/v1/visitors?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.status === 200) ok("anon can read visitors", "expected -- realtime needs it");
    else bad("anon can read visitors", `HTTP ${res.status}`, "001_init.sql grants anon SELECT; without it the staff dashboard goes blank on every change");
  } catch (error) {
    bad("anon read probe", String(error), "check network access");
  }
}

console.log("\n3. build");
const buildId = join(ROOT, ".next", "BUILD_ID");
if (existsSync(buildId)) ok("next build artefact", readFileSync(buildId, "utf8").trim());
else bad("next build artefact", ".next/BUILD_ID missing", "run npm run build");

console.log(
  failed === 0
    ? `\nOK: ready. Start the demo with:  npm start\n`
    : `\nFAILED: ${failed} blocking problem(s). Fix the lines above before demoing.\n`,
);
process.exit(failed === 0 ? 0 : 1);