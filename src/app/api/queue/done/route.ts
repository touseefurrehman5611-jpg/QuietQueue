// POST /api/queue/done
//
// Staff finish with the person at the desk. We save how long it really took,
// which is what makes the wait estimate get better over the day.
//
// Body: { visitorId: string, simulatedSeconds?: number }
//
// simulatedSeconds is for the demo: instead of waiting for a real visit to end,
// the tester says "pretend this took 120 seconds". Without it we time it from
// when the visitor was called.

import { addServiceEvent, getVisitor, setVisitorStatus } from "@/lib/db";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString, toCount } from "@/lib/validate";

export async function GET() {
  return fail("use POST", 405);
}

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    if (!body) return fail("request body must be a JSON object");
    if (!isNonEmptyString(body?.visitorId)) return fail("visitorId is required");

    const visitor = await getVisitor(body.visitorId.trim());

    if (visitor.status !== "called") {
      return fail(`visitor is ${visitor.status}, not called`, 409);
    }

    const now = new Date();

    // Prefer the demo value if given, otherwise time it for real.
    const simulated = toCount(body.simulatedSeconds);
    const startedAt = visitor.calledAt ? new Date(visitor.calledAt).getTime() : null;
    const realSeconds = startedAt ? Math.round((now.getTime() - startedAt) / 1000) : 0;
    const durationSeconds = simulated ?? realSeconds;

    const served = await setVisitorStatus(visitor.id, "served", {
      servedAt: now.toISOString(),
    });

    // Recorded even when the duration is 0 seconds, so the history is a true
    // record of the day. A new queue starts with these rows as its average.
    const event = await addServiceEvent(visitor.queueId, visitor.id, durationSeconds);

    return ok({
      visitor: served,
      durationSeconds: event.durationSeconds,
      simulated: simulated !== null,
    });
  });
}