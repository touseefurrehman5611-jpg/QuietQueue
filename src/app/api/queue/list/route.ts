// GET /api/queue/list?queueId=...
//
// What staff see. The whole line plus the two dashboard numbers.
//
// Query: ?queueId=<uuid>

import { getQueue, getStats, listActiveVisitors } from "@/lib/db";
import { ok, fail, run } from "@/lib/respond";

export async function GET(request: Request) {
  return run(async () => {
    const queueId = new URL(request.url).searchParams.get("queueId");
    if (!queueId) return fail("queueId is required");

    const queue = await getQueue(queueId);
    const active = await listActiveVisitors(queueId);
    const stats = await getStats(queueId);

    return ok({
      queue: {
        id: queue.id,
        name: queue.name,
        speedMultiplier: queue.speedMultiplier,
        alertAtPosition: queue.alertAtPosition,
      },
      // Already split out so Amna does not filter on the client.
      waiting: active.filter((v) => v.status === "waiting"),
      called: active.filter((v) => v.status === "called"),
      stats,
    });
  });
}