// An optional check on the staff routes.
//
// WHY THIS EXISTS: every route uses the Supabase service role, which bypasses
// row level security. Without this, anyone who can reach the server can call
// /api/queue/next and empty the queue. RLS does not help here because RLS only
// applies to the anon and authenticated keys, and we deliberately never use them
// on the server.
//
// WHY IT IS OPTIONAL: this is a student demo, and a required header that the
// frontend forgets on demo day is a worse failure than a localhost-only gap. So
// with no STAFF_KEY set, staffKey() returns null and every route behaves exactly
// as it did before. Set STAFF_KEY in .env.local and the routes lock down.
//
// The visitor routes (/join, /status) are never checked. A visitor has no
// secret to present, and checking them would only get in the way.

const HEADER = "x-staff-key";

// Returns null when access is fine, or a ready-to-return 403 when it is not.
// Call it as: const denied = staffKey(request); if (denied) return denied;
export function staffKey(request: Request): Response | null {
  const expected = process.env.STAFF_KEY;

  // Not configured, so not enforced. See the note at the top.
  if (!expected) return null;

  const provided = request.headers.get(HEADER);

  if (provided === expected) return null;

  // Deliberately says nothing about what was wrong or what was expected. A
  // message naming the header would help an attacker and helps nobody else,
  // since the real answer is always in the server log.
  return Response.json(
    { ok: false, error: "not allowed" },
    { status: 403 },
  );
}