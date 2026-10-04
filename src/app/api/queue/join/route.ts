// POST /api/queue/join
//
// A visitor takes a ticket. We save them, then immediately tell them their
// position and roughly how long they will wait.
//
// Body: { queueId?: string, name: string, phone?: string }
//
// queueId is optional. The join form has no queue picker, so Amna's UI never
// sends one and the server picks (see resolveQueueId in db.ts). Sending it still
// works and wins, so a caller with several queues can still target one.
//
// Every rule about what a valid join looks like lives in validateJoinInput in
// validate.ts, because Asad owns that file and improves it later. Nothing here
// re-checks or re-trims what it already validated.
//
// The queue is resolved BEFORE validation and then handed to it, rather than
// making validateJoinInput accept a missing queueId. That keeps Asad's contract
// "a join names its queue" intact, while the route still has one. The cost is
// one extra query on a join that sent no queueId, which is the rare case.

import { checkAndMarkAlerts } from "@/lib/alerts";
import {
  createVisitor,
  getQueue,
  getRecentServiceDurations,
  listActiveVisitors,
  resolveQueueId,
} from "@/lib/db";
import { predictForVisitor } from "@/lib/prediction";
import { ok, fail, run, readJson } from "@/lib/respond";
import { validateJoinInput } from "@/lib/validate";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    if (!body) return fail("request body must be a JSON object");

    const fallback = await resolveQueueId();
    const checked = validateJoinInput({ ...body, queueId: body.queueId ?? fallback.id });
    if (!checked.valid) return fail(checked.error);
    const { queueId, name, phone } = checked.clean;

    // When a queueId WAS sent, load it. getQueue fails first if the id is not a
    // real queue, so we never try to insert a visitor pointing at nothing.
    const queue = body.queueId ? await getQueue(queueId) : fallback;

    const visitor = await createVisitor(queue.id, name, phone);

    const active = await listActiveVisitors(queue.id);
    const recent = await getRecentServiceDurations(queue.id);
    const estimate = predictForVisitor(visitor, active, recent, queue);

    // Joining an empty queue puts somebody straight into the alert window, and
    // no staff action follows, so nothing else would ever mark them. The alerted
    // flag makes this safe to run on every join.
    await checkAndMarkAlerts(queue.id);

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