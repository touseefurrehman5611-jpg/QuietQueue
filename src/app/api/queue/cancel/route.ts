// POST /api/queue/cancel
//
// Somebody gave up and left. Take them out of the line without touching anyone
// else's ticket number.
//
// Body: { visitorId: string }

import { getVisitor, setVisitorStatus } from "@/lib/db";
import { ok, fail, run } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  return run(async () => {
    const body = await request.json();
    if (!isNonEmptyString(body?.visitorId)) return fail("visitorId is required");

    const visitor = await getVisitor(body.visitorId.trim());

    if (visitor.status === "served") return fail("visitor has already been served", 409);
    if (visitor.status === "cancelled") return fail("visitor is already cancelled", 409);

    const cancelled = await setVisitorStatus(visitor.id, "cancelled");

    return ok({ visitor: cancelled });
  });
}