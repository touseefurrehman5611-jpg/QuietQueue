// GET /api/queue/list?queueId=...
//
// What staff see. The whole line plus the dashboard numbers.
//
// Query: ?queueId=<uuid>   (optional -- the server picks one, see resolveQueueId)
//
// Each visitor carries their own position and wait window, so the staff screen
// can show "3rd, about 12 to 18 min" without doing any arithmetic. That is
// additive: everything the visitor object already had is still here, including
// phone, which the staff screen wants.
//
// WHY PHONE IS FETCHED SEPARATELY: the phone number is not a column on the
// `visitors` table any more. It lives in `visitor_phones`, which has no anon
// read policy, because the anon key can read `visitors` (needed for Realtime)
// and a phone number in a publicly readable column is a privacy problem. See
// 002_phone_split.sql.
//
// THIS ROUTE IS THE ONLY PLACE A PHONE NUMBER IS EVER SENT TO A CLIENT. It is
// staff-gated by auth.ts above and reads through the service role, which
// bypasses RLS. So the staff screen keeps working unchanged, and no visitor-
// facing endpoint (/join, /status) can leak a number, because neither of them
// calls this.

import {
  getQueue,
  getRecentServiceDurations,
  getStats,
  getVisitorPhones,
  listActiveVisitors,
  resolveQueueId,
} from "@/lib/db";
import { staffKey } from "@/lib/auth";
import { predictForVisitor } from "@/lib/prediction";
import { ok, run } from "@/lib/respond";

export async function GET(request: Request) {
  const denied = staffKey(request);
  if (denied) return denied;

  return run(async () => {
    const requested = new URL(request.url).searchParams.get("queueId");

    // Amna's staff screen opens at /staff with nothing to put a queueId in, so
    // a missing one is normal here rather than a mistake.
    const queue = requested ? await getQueue(requested) : await resolveQueueId();
    const queueId = queue.id;
    const active = await listActiveVisitors(queueId);
    const stats = await getStats(queueId);
    const recent = await getRecentServiceDurations(queueId);

    // One extra read, only on this route. A visitor with no row in the table
    // gave no number, so the lookup returns null and the field keeps the shape
    // Amna already coded against.
    const phones = await getVisitorPhones(active.map((v) => v.id));

    // Spread the visitor, then add the numbers. Keeping every original field
    // means anything Amna coded against before today still works.
    const withEstimate = active.map((visitor) => ({
      ...visitor,
      phone: phones.get(visitor.id) ?? null,
      ...predictForVisitor(visitor, active, recent, queue),
    }));

    return ok({
      queue: {
        id: queue.id,
        name: queue.name,
        speedMultiplier: queue.speedMultiplier,
        alertAtPosition: queue.alertAtPosition,
      },
      // Already split out so Amna does not filter on the client.
      waiting: withEstimate.filter((v) => v.status === "waiting"),
      called: withEstimate.filter((v) => v.status === "called"),
      stats,
    });
  });
}