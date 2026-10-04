// POST /api/queue/next
//
// Staff press one button to call the next person in line.
//
// Body: { queueId?: string }
//
// queueId is optional, same as on /join and /list. The "Call Next" button
// posts an empty body because the staff screen has no queue picker.

import { checkAndMarkAlerts } from "@/lib/alerts";
import { staffKey } from "@/lib/auth";
import { getQueue, listActiveVisitors, resolveQueueId, setVisitorStatus } from "@/lib/db";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  const denied = staffKey(request);
  if (denied) return denied;

  return run(async () => {
    // A missing or unparseable body is fine here: queueId is optional, so an
    // empty POST means "call whoever is next in the default queue".
    const body = (await readJson(request)) ?? {};
    const queue = isNonEmptyString(body.queueId)
      ? await getQueue(body.queueId.trim())
      : await resolveQueueId();
    const active = await listActiveVisitors(queue.id);

    // listActiveVisitors already sorts by ticket number, so the first waiting
    // person is the next one. "called" people are skipped: they are already at
    // the desk, and pressing next twice must not skip them.
    const next = active.find((v) => v.status === "waiting");
    if (!next) return fail("No one is waiting", 404);

    const called = await setVisitorStatus(next.id, "called", {
      calledAt: new Date().toISOString(),
    });

    // Somebody just moved closer to the front, so somebody else just entered
    // the alert window. The alerted flag makes this safe to run every time.
    await checkAndMarkAlerts(queue.id);

    return ok({
      visitor: called,
      message: `Ticket ${called.ticketNo} (${called.name}) please come to the desk.`,
    });
  });
}