// POST /api/queue/next
//
// Staff press one button to call the next person in line.
//
// Body: { queueId: string }

import { checkAndMarkAlerts } from "@/lib/alerts";
import { staffKey } from "@/lib/auth";
import { getQueue, listActiveVisitors, setVisitorStatus } from "@/lib/db";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString } from "@/lib/validate";

export async function POST(request: Request) {
  const denied = staffKey(request);
  if (denied) return denied;

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