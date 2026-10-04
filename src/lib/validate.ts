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
