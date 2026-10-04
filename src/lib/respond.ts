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

// Wraps a route handler so a thrown Error always becomes the same shape, instead
// of Next.js sending its own HTML error page. Every route uses this, so a
// database failure looks identical to a bad request from the outside.
//
// The handler inside returns ok(...) or fail(...). If it throws, we send the
// error text with a 500.
export async function run(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return fail(message, 500);
  }
}