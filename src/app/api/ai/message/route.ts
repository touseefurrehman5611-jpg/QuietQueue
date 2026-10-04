// POST /api/ai/message
//
// Turns a wait estimate into one friendly sentence.
//
// Body, two accepted shapes:
//   { visitorId, type }                       -- the short one. We look the
//     visitor up and work the numbers out ourselves.
//   { position, minMinutes, maxMinutes, ... } -- numbers you already have.
//
// Both work. Amna can move to the first whenever she likes without the second
// breaking, and the second is what makes this endpoint testable without a
// database behind it.
//
// PRIVACY: nothing identifying leaves the server. The visitor's name, phone and
// ticket number are never sent to Groq, only how many people are ahead and how
// many minutes. The sentence is about the wait, not the person, so the name was
// never needed. If someone later wants a personalised greeting, they have to
// add it here deliberately, knowing it goes to a third party.
//
// You can also skip this endpoint entirely. `/api/queue/status` already returns
// a ready-made `message` when the visitor is in the alert window or has been
// called, so the normal path never needs this call at all.

import { generateVisitorMessage, type MessageType } from "@/lib/ai";
import { getQueue, getRecentServiceDurations, getVisitor, listActiveVisitors } from "@/lib/db";
import { predictForVisitor } from "@/lib/prediction";
import { ok, fail, run, readJson } from "@/lib/respond";
import { isNonEmptyString, oneOf, toCount } from "@/lib/validate";

const MESSAGE_TYPES = ["joined", "alert", "delay", "called"] as const;

export async function POST(request: Request) {
  return run(async () => {
    const body = await readJson(request);
    if (!body) return fail("request body must be a JSON object");

    // Shape 1: hand us an id and we do the arithmetic.
    if (isNonEmptyString(body.visitorId)) {
      const type = oneOf<MessageType>(body.type, MESSAGE_TYPES);
      if (!type) return fail("type must be joined, alert, delay or called");

      const visitor = await getVisitor(body.visitorId.trim());

      // A finished visit has no wait left to describe.
      if (visitor.status === "served" || visitor.status === "cancelled") {
        return ok({
          message: "Your visit is finished. Thank you for waiting.",
          source: "fallback" as const,
          reason: "visitor has left the queue",
        });
      }

      const queue = await getQueue(visitor.queueId);
      const active = await listActiveVisitors(queue.id);
      const recent = await getRecentServiceDurations(queue.id);
      const estimate = predictForVisitor(visitor, active, recent, queue);

      const generated = await generateVisitorMessage({
        position: estimate.position,
        minMinutes: estimate.minMinutes,
        maxMinutes: estimate.maxMinutes,
        type,
      });

      return ok(generated);
    }

    // Shape 2: numbers supplied directly.
    const position = toCount(body.position);
    if (position === null) return fail("position is required");
    if (position < 1) return fail("position must be 1 or more");

    const minMinutes = toCount(body.minMinutes) ?? 0;
    const maxMinutes = toCount(body.maxMinutes) ?? minMinutes;

    // An explicit type wins. Without one, guess from the numbers so the old
    // call shape keeps producing the same sentences it always did.
    const type: MessageType =
      oneOf<MessageType>(body.type, MESSAGE_TYPES) ??
      (position === 1
        ? "called"
        : body.shouldAlert === true
          ? "alert"
          : "joined");

    const generated = await generateVisitorMessage({
      position,
      minMinutes,
      maxMinutes,
      type,
    });

    return ok(generated);
  });
}