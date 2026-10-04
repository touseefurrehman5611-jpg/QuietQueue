// POST /api/queue/next
//
// Staff press one button to call the next person in line.
//
// Body: { queueId: string }

import { getQueue, listActiveVisitors, setVisitorStatus } from "@/lib/db";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    if (!body) return fail("request body must be a JSON object");
    if (!isNonEmptyString(body?.queueId)) return fail("queueId is required");

    const queue = await getQueue(body.queueId.trim());
    const active = await listActiveVisitors(queue.id);

    // listActiveVisitors already sorts by ticket number, so the first waiting
    // person is the next one. "called" people are skipped: they are already at
    // the desk, and pressing next twice must not skip them.
    const next = active.find((v) => v.status === "waiting");
    if (!next) return fail("nobody is waiting in this queue", 404);

    const called = await setVisitorStatus(next.id, "called", {
      calledAt: new Date().toISOString(),
    });

    return ok({
      visitor: called,
      message: `Ticket ${called.ticketNo} (${called.name}) please come to the desk.`,
    });
  });
}