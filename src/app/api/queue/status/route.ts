// GET /api/queue/status?visitorId=...
//
// What one visitor sees on their phone. Polled every few seconds.
//
// Query: ?visitorId=<uuid>

import { getQueue, getRecentServiceDurations, getVisitor, listActiveVisitors, markAlerted } from "@/lib/db";
import { waitEstimate } from "@/lib/prediction";
import { ok, fail, run } from "@/lib/respond";

export async function GET(request: Request) {
  return run(async () => {
    const visitorId = new URL(request.url).searchParams.get("visitorId");
    if (!visitorId) return fail("visitorId is required");

    const visitor = await getVisitor(visitorId);
    const queue = await getQueue(visitor.queueId);

    // Finished visitors get a plain answer. No queue maths needed.
    if (visitor.status === "served" || visitor.status === "cancelled") {
      return ok({
        status: visitor.status,
        ticketNo: visitor.ticketNo,
        position: null,
        peopleAhead: null,
        minMinutes: null,
        maxMinutes: null,
        shouldAlert: false,
        alerted: visitor.alerted,
      });
    }

    const active = await listActiveVisitors(queue.id);
    const peopleAhead = active.filter((v) => v.ticketNo < visitor.ticketNo).length;

    const recent = await getRecentServiceDurations(queue.id);
    const estimate = waitEstimate(peopleAhead, queue, recent);

    // Once staff have called you, you are at the desk. Waiting is over, so tell
    // them now regardless of how many people are nominally ahead.
    const called = visitor.status === "called";
    const shouldAlert = called || estimate.shouldAlert;

    // Remember that we have alerted them, so the frontend only fires the
    // notification once. The browser calls /api/ai/message for the wording.
    let alerted = visitor.alerted;
    if (shouldAlert && !alerted) {
      await markAlerted(visitor.id);
      alerted = true;
    }

    return ok({
      status: visitor.status,
      ticketNo: visitor.ticketNo,
      queueName: queue.name,
      position: called ? 1 : estimate.position,
      peopleAhead: called ? 0 : estimate.peopleAhead,
      minMinutes: called ? 0 : estimate.minMinutes,
      maxMinutes: called ? 0 : estimate.maxMinutes,
      shouldAlert,
      alerted,
    });
  });
}