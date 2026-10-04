// POST /api/queue/join
//
// A visitor takes a ticket. We save them, then immediately tell them their
// position and roughly how long they will wait.
//
// Body: { queueId: string, name: string, phone?: string }

import { createVisitor, getQueue, getRecentServiceDurations, listActiveVisitors } from "@/lib/db";
import { waitEstimate } from "@/lib/prediction";
import { ok, fail, run } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  return run(async () => {
    const body = await request.json();

    if (!isNonEmptyString(body?.queueId)) return fail("queueId is required");
    if (!isNonEmptyString(body?.name)) return fail("name is required");

    // Phone is optional. Ignore it if it is not a real string.
    const phone = isNonEmptyString(body.phone) ? body.phone.trim() : null;

    // getQueue fails first if the id is not a real queue, so we never try to
    // insert a visitor pointing at nothing.
    const queue = await getQueue(body.queueId.trim());

    const visitor = await createVisitor(queue.id, body.name.trim(), phone);

    // Everyone still in the line with a smaller ticket number.
    const active = await listActiveVisitors(queue.id);
    const peopleAhead = active.filter((v) => v.ticketNo < visitor.ticketNo).length;

    const recent = await getRecentServiceDurations(queue.id);
    const estimate = waitEstimate(peopleAhead, queue, recent);

    return ok(
      {
        visitorId: visitor.id,
        ticketNo: visitor.ticketNo,
        queueName: queue.name,
        position: estimate.position,
        peopleAhead: estimate.peopleAhead,
        minMinutes: estimate.minMinutes,
        maxMinutes: estimate.maxMinutes,
        shouldAlert: estimate.shouldAlert,
      },
      201,
    );
  });
}