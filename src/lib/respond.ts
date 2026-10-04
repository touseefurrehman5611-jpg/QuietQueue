// One way to send a good answer and one way to send a bad one, so every route
// replies the same shape. Amna's frontend checks these two fields only.

import { NextResponse } from "next/server";

// Success. `ok(data)` sends 200, `ok(data, 201)` sends 201.
// Sends { ok: true, data: { ... } }
export function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

// Failure. Always sends { ok: false, error: "..." } so the client can show one
// message. Default status is 400 (the caller sent something wrong).
export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// Postgres/PostgREST error codes we can turn into an honest HTTP status.
// PGRST116 = the query matched no rows (".single()" on a missing id).
// 22P02   = invalid text representation, i.e. a malformed uuid.
const NOT_FOUND = "PGRST116";
const BAD_SYNTAX = "22P02";

// Wraps a route handler so a thrown Error always becomes the same shape, instead
// of Next.js sending its own HTML error page. Every route uses this, so a
// database failure looks identical to a bad request from the outside.
//
// The handler inside returns ok(...) or fail(...). If it throws, we work out the
// status from the Postgres code the db layer attached:
//
//   PGRST116 -> 404  the id does not exist
//   22P02    -> 400  the id is not even a uuid
//   anything else -> 500, but WITHOUT the raw Postgres text.
//
// The raw message is dropped on a 500 on purpose. It contains table and column
// names, and it echoes back whatever the caller sent, so passing it straight
// through hands an anonymous caller a map of the schema. Developers can still
// see it in the server log.
export async function run(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : "unknown error";

    if (code === NOT_FOUND) return fail("not found", 404);
    if (code === BAD_SYNTAX) return fail("invalid id format", 400);

    console.error("[quietqueue]", message);
    return fail("something went wrong on our side", 500);
  }
}

// Read a JSON request body without turning a malformed body into a 500.
//
// request.json() throws a SyntaxError on an empty or broken body, which would
// otherwise be reported as a server fault when it is really a bad request.
// Returns null so the route can answer with its own message.
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    // A JSON body can be a number, a string or null. We only ever want an
    // object to read fields from.
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}