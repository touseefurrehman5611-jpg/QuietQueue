// POST /api/queue/speed
//
// Staff move the speed slider. 1 is normal, 2 is twice as fast, 0.5 is half.
//
// Body: { queueId: string, speedMultiplier: number }

import { updateQueueSpeed } from "@/lib/db";
import { ok, fail, run } from "@/lib/respond";
import { isNonEmptyString, toSpeed } from "@/lib/validate";

export async function POST(request: Request) {
  return run(async () => {
    const body = await request.json();
    if (!isNonEmptyString(body?.queueId)) return fail("queueId is required");

    // toSpeed only accepts 0.25 to 4. Anything else is a 400, so a typo can
    // never make the wait estimate divide by zero or run away.
    const speed = toSpeed(body.speedMultiplier);
    if (speed === null) {
      return fail("speedMultiplier must be a number between 0.25 and 4");
    }

    // updateQueueSpeed fails with a readable error if the queue id is wrong.
    const queue = await updateQueueSpeed(body.queueId.trim(), speed);

    return ok({ queue });
  });
}