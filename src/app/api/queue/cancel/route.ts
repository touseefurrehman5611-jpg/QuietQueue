// POST /api/queue/cancel
//
// Somebody gave up and left. Take them out of the line without touching anyone
// else's ticket number.
//
// Body: { visitorId: string }

import { checkAndMarkAlerts } from "@/lib/alerts";
import { staffKey } from "@/lib/auth";
import { getVisitor, setVisitorStatus } from "@/lib/db";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  const denied = staffKey(request);
  if (denied) return denied;

  return run(async () => {
    const body = await readJson(request);
    if (!body) return fail("request body must be a JSON object");
    if (!isNonEmptyString(body?.visitorId)) return fail("visitorId is required");

    const visitor = await getVisitor(body.visitorId.trim());

    // Waiting or called are both fine to cancel: they gave up before or after
    // reaching the desk. Only a finished visit is off limits, because changing
    // it would rewrite history that the average wait is built from.
    if (visitor.status === "served") return fail("visitor has already been served", 409);
    if (visitor.status === "cancelled") return fail("visitor is already cancelled", 409);

    const cancelled = await setVisitorStatus(visitor.id, "cancelled");

    // A gap just closed, so the people behind them just moved up.
    await checkAndMarkAlerts(visitor.queueId);

    return ok({ visitor: cancelled });
  });
}