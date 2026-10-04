// The client half of the API contract.
//
// Every route in src/app/api answers in one envelope: { ok: true, data } on
// success and { ok: false, error } on failure (see src/lib/respond.ts). React
// components should not each re-implement that check, so they call these two
// functions instead and get the unwrapped `data`.
//
//   const data = await apiGet<QueueList>("/api/queue/list");
//   const data = await apiPost<{ visitor: Visitor }>("/api/queue/next", {});
//
// A failure THROWS rather than returning null, so a component cannot forget to
// check and render `undefined.ticketNo` at somebody during a demo. The thrown
// error carries `.status`, which is how the visitor page tells "no such visitor"
// (404, show the input again) from "the network is down" (retry silently).

type Failure = Error & { status?: number };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  // A route that dies before it can answer sends HTML, not JSON. res.json()
  // throws on that, and we want the catch-all message rather than a parse error.
  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.ok) {
    const error: Failure = new Error(body?.error ?? `request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }

  return body.data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return call<T>(path);
}

export function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  return call<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) });
}

// The status code of the last failure, for the one caller that needs it.
// Returns undefined when the error did not come from a route.
export function statusOf(error: unknown): number | undefined {
  return (error as Failure | null)?.status;
}