// POST /api/demo/simulate
//
// Fills the queue with a handful of made-up visitors, so the staff dashboard
// has something to show before a real queue exists. Amna's "Simulate" button
// calls this.
//
// This is a demo affordance and nothing else: it is the only route that writes
// visitors whose names it invented. It still goes through createVisitor, so the
// ticket numbers are real sequential ones like everyone else's, and it is still
// staff-gated.
//
// Body: { count?: number }   (1 to 20, default 5-9 at random)

import { createVisitor, listActiveVisitors, resolveQueueId } from "@/lib/db";
import { staffKey } from "@/lib/auth";
import { ok, fail, run, readJson } from "@/lib/respond";
import { toCount } from "@/lib/validate";

// Fixed rotation rather than random names, so a demo looks the same twice and
// nobody ends up called "Wendy Null".
const NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Henry", "Iris", "Jack"];

// Enough to fill a screen, few enough that the average wait stays believable.
const MIN_COUNT = 1;
const MAX_COUNT = 20;

export async function POST(request: Request) {
  const denied = staffKey(request);
  if (denied) return denied;

  return run(async () => {
    const body = (await readJson(request)) ?? {};

    // 5 to 9, so a second click visibly changes the queue instead of doubling it.
    const asked = toCount(body.count);
    const count = asked ?? 5 + Math.floor(Math.random() * 5);

    if (count < MIN_COUNT || count > MAX_COUNT) {
      return fail(`count must be between ${MIN_COUNT} and ${MAX_COUNT}`);
    }

    // No queueId here on purpose. This route fills the queue the whole app is
    // pointed at (see resolveQueueId), so accepting an id would only let the
    // demo button fill a queue nobody is looking at.
    const queue = await resolveQueueId();

    // Sequential on purpose. createVisitor numbers each one from the current
    // max, so they land 1, 2, 3 like real visitors and the position maths on
    // screen stays honest.
    const added = [];
    for (let i = 0; i < count; i++) {
      added.push(await createVisitor(queue.id, `${NAMES[i % NAMES.length]} ${i + 1}`, null));
    }

    const active = await listActiveVisitors(queue.id);

    return ok({
      added: added.length,
      queueId: queue.id,
      waiting: active.filter((v) => v.status === "waiting").length,
    }, 201);
  });
}