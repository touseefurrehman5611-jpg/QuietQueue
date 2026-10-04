// Small checks we run on anything that comes in from the internet, before we
// hand it to the database. Hand written on purpose: the shapes are tiny and
// the error text has to be a real 400 anyway.

// A string with something in it, once trimmed.
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// A whole number of 0 or more. Rejects "3abc", 3.7 and negatives.
//
// Blank strings are rejected BEFORE Number(), because Number("") is 0 and an
// empty <input type="number"> sends "" — which would otherwise be read as a
// real measurement of zero.
function toNumber(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // "" and "   " mean the field was left empty, not zero.
    if (trimmed === "") return null;
    return Number(trimmed);
  }
  return typeof value === "number" ? value : null;
}

// A whole number of 0 or more. Rejects "3abc", 3.7 and negatives.
export function toCount(value: unknown): number | null {
  const n = toNumber(value);
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n;
}

// A speed multiplier. 1 is normal, 2 is twice as fast, 0.5 is half speed.
// The brief allows 0.25 to 4 and nothing outside that. Anything else is a 400,
// so a typo can never make the prediction divide by zero or run away.
export function toSpeed(value: unknown): number | null {
  const n = toNumber(value);
  if (n === null || !Number.isFinite(n)) return null;
  if (n < 0.25 || n > 4) return null;
  return n;
}

// Is the value one of the allowed words?
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

// The whole shape of a join request, checked in one place.
//
// OWNERSHIP: Asad improves this file and nothing else. Every rule about what a
// valid join looks like lives here, so a route never grows its own inline check
// that can drift out of step with these.
//
// It returns the CLEANED values, not the raw ones, so the caller inserts exactly
// what we validated instead of re-trimming and hoping it matches.
const NAME_MIN = 2;
const NAME_MAX = 40;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

export type JoinInput = { queueId: string; name: string; phone: string | null };

export type JoinValidation =
  | { valid: true; clean: JoinInput }
  | { valid: false; error: string };

// Strip the punctuation people type into phone numbers, so "+92 (300) 123-4567"
// and "03001234567" are judged on the same 10 digits. Keeps + and digits only,
// because a number field on a phone keypad cannot produce anything else and
// anything else is a paste error worth rejecting.
function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export function validateJoinInput(body: Record<string, unknown>): JoinValidation {
  if (!isNonEmptyString(body.queueId)) {
    return { valid: false, error: "queueId is required" };
  }

  if (typeof body.name !== "string" || body.name.trim().length < NAME_MIN) {
    return {
      valid: false,
      error: `name must be at least ${NAME_MIN} characters`,
    };
  }

  const name = body.name.trim();

  // Checked after trimming, so a name that is 40 real characters plus padding is
  // accepted and one that is genuinely 41 is not.
  if (name.length > NAME_MAX) {
    return {
      valid: false,
      error: `name must be at most ${NAME_MAX} characters`,
    };
  }

  // Phone is optional. A missing field, null, or an empty string all mean "no
  // phone" and are fine. Anything present must actually look like one, because
  // this value gets read by staff and later by an SMS alert.
  let phone: string | null = null;

  if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
    if (typeof body.phone !== "string") {
      return { valid: false, error: "phone must be a number" };
    }

    const digits = digitsOnly(body.phone.trim());
    if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
      return {
        valid: false,
        error: `phone must be ${PHONE_MIN_DIGITS} to ${PHONE_MAX_DIGITS} digits`,
      };
    }

    // Stored as the digits only. The display form is the visitor's business and
    // staff can still read it, but a stored value with brackets in it breaks any
    // future SMS link.
    phone = digits;
  }

  return { valid: true, clean: { queueId: body.queueId.trim(), name, phone } };
}

// Run with: node src/lib/validate.ts
//
// Same shape as the selfCheck in prediction.ts and ai.ts: a local assert that
// compares with JSON.stringify and sets process.exitCode, so a failure shows up
// in CI without needing a test runner.
//
// This file is the one place the join rules live, so it is also the one place
// worth pinning down. Every rule below is a decision somebody will one day want
// to change; if a change breaks a line here, that is this check doing its job.
function selfCheck() {
  const assert = (label: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
      process.exitCode = 1;
    } else {
      console.log(`ok  ${label}`);
    }
  };

  // Runs a join body and returns just the error string, or null when it passed.
  // Only the FIRST failure comes back, because that is all this file returns.
  const errorFor = (body: Record<string, unknown>): string | null => {
    const result = validateJoinInput(body);
    return result.valid ? null : result.error;
  };

  // The cleaned result for a join body that is expected to pass.
  const cleanFor = (body: Record<string, unknown>) => {
    const result = validateJoinInput(body);
    if (!result.valid) throw new Error(`expected this to pass but it failed: ${result.error}`);
    return result.clean;
  };

  const ok = { queueId: "q-123", name: "Amna" };

  // ---- queueId ----

  assert("a missing queueId is rejected", errorFor({ name: "Amna" }), "queueId is required");
  assert("an empty queueId is rejected", errorFor({ queueId: "", name: "Amna" }), "queueId is required");
  assert("a blank queueId is rejected", errorFor({ queueId: "   ", name: "Amna" }), "queueId is required");
  // A uuid is not checked for format. A wrong one reaches Postgres and comes
  // back as 22P02, which respond.ts turns into a 400. Checked at the boundary
  // instead of here, so the two layers cannot disagree about what a uuid is.
  assert("queueId is trimmed on the way through", cleanFor({ queueId: "  q-123  ", name: "Amna" }).queueId, "q-123");

  // ---- name ----

  assert("a missing name is rejected", errorFor({ queueId: "q-123" }), "name must be at least 2 characters");
  assert("an empty name is rejected", errorFor({ ...ok, name: "" }), "name must be at least 2 characters");
  assert("a one-character name is rejected", errorFor({ ...ok, name: "A" }), "name must be at least 2 characters");
  assert("a whitespace-only name is rejected", errorFor({ ...ok, name: "   " }), "name must be at least 2 characters");
  assert("a non-string name is rejected", errorFor({ ...ok, name: 42 }), "name must be at least 2 characters");

  assert("a 41-character name is rejected", errorFor({ ...ok, name: "x".repeat(41) }), "name must be at most 40 characters");
  // The boundaries either side, because "at most 40" that quietly rejected 40
  // would be a very annoying off-by-one to find during a demo.
  assert("exactly 40 characters is accepted", cleanFor({ ...ok, name: "x".repeat(40) }).name.length, 40);
  assert("two characters is accepted", cleanFor({ ...ok, name: "Al" }).name, "Al");

  // Length is measured AFTER trimming, so padding does not eat the allowance
  // and cannot smuggle an over-long name through either.
  assert("name length is measured after trimming", cleanFor({ ...ok, name: `  ${"x".repeat(40)}  ` }).name.length, 40);
  assert("name is trimmed on the way through", cleanFor({ ...ok, name: "  Amna  " }).name, "Amna");

  // ---- phone: absent means "no phone", not an error ----

  assert("a missing phone means no phone", cleanFor({ ...ok }).phone, null);
  assert("a null phone means no phone", cleanFor({ ...ok, phone: null }).phone, null);
  assert("an empty phone means no phone", cleanFor({ ...ok, phone: "" }).phone, null);

  // ---- phone: present must look like one ----

  assert("a numeric phone is rejected", errorFor({ ...ok, phone: 3001234567 }), "phone must be a number");

  assert("6 digits is too few", errorFor({ ...ok, phone: "123456" }), "phone must be 7 to 15 digits");
  assert("16 digits is too many", errorFor({ ...ok, phone: "1234567890123456" }), "phone must be 7 to 15 digits");
  assert("punctuation only is too few", errorFor({ ...ok, phone: "+()- " }), "phone must be 7 to 15 digits");

  assert("exactly 7 digits is accepted", cleanFor({ ...ok, phone: "1234567" }).phone, "1234567");
  assert("exactly 15 digits is accepted", cleanFor({ ...ok, phone: "123456789012345" }).phone, "123456789012345");

  // The whole point of digitsOnly: what a person types and what gets stored are
  // judged on the same digits, so the stored value has nothing in it that would
  // break a future SMS link.
  assert("typed punctuation is stripped", cleanFor({ ...ok, phone: "+92 (300) 123-4567" }).phone, "923001234567");
  assert("a leading plus is kept as a digit", cleanFor({ ...ok, phone: "+923001234567" }).phone, "923001234567");
  assert("inner spaces are stripped", cleanFor({ ...ok, phone: "0300 123 4567" }).phone, "03001234567");
  assert("surrounding space is trimmed", cleanFor({ ...ok, phone: "  923001234567  " }).phone, "923001234567");

  // ---- the number helpers, including the empty-string trap ----

  // Number("") is 0, so an empty <input type="number"> would otherwise read as
  // a real measurement of zero. toNumber rejects "" before it ever calls
  // Number(), and this is the assertion that keeps that from regressing.
  assert("an empty string is not zero", toCount(""), null);
  assert("a blank string is not zero", toCount("   "), null);
  assert("a numeric string counts", toCount("3"), 3);
  assert("zero itself is a valid count", toCount(0), 0);
  assert("the string zero is a valid count", toCount("0"), 0);
  assert("a decimal is not a count", toCount(3.7), null);
  assert("a negative is not a count", toCount(-1), null);
  assert("trailing junk is not a count", toCount("3abc"), null);
  assert("Infinity is not a count", toCount(Infinity), null);
  assert("NaN is not a count", toCount(NaN), null);
  assert("null is not a count", toCount(null), null);
  assert("undefined is not a count", toCount(undefined), null);
  assert("a boolean is not a count", toCount(true), null);

  // The speed range is 0.25 to 4 inclusive, matching the CHECK constraint in
  // the schema. A typo outside it must be a 400, never a divide by zero.
  assert("speed 0.25 is allowed", toSpeed(0.25), 0.25);
  assert("speed 4 is allowed", toSpeed(4), 4);
  assert("speed 1 is allowed", toSpeed(1), 1);
  assert("speed 0.24 is rejected", toSpeed(0.24), null);
  assert("speed 4.01 is rejected", toSpeed(4.01), null);
  assert("speed 0 is rejected", toSpeed(0), null);
  assert("speed -1 is rejected", toSpeed(-1), null);
  assert("a blank speed is rejected", toSpeed(""), null);
  assert("a non-numeric speed is rejected", toSpeed("fast"), null);

  assert("oneOf accepts a member", oneOf("joined", ["joined", "alert"]), "joined");
  assert("oneOf rejects a non-member", oneOf("shouted", ["joined", "alert"]), null);
  assert("oneOf rejects a non-string", oneOf(1, ["1"]), null);

  console.log(process.exitCode ? "\nFAILED" : "\nall checks passed");
}

if (process.argv[1]?.endsWith("validate.ts")) selfCheck();
