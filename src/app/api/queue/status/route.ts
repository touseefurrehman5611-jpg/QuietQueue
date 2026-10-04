// GET /api/queue/status?visitorId=...
//
// What one visitor sees on their phone. Polled every few seconds.
//
// `message` is why Amna never has to call /api/ai/message herself: the sentence
// is already in this response, ready to render or to put in a browser
// notification.
//
// WHO OWNS THE `alerted` COLUMN: checkAndMarkAlerts in alerts.ts, and only
// that. It runs when staff act (next / done / cancel), which is what will
// eventually drive the SMS. This route deliberately does NOT write it. One
// owner for one flag: if two places set it, the "never alert twice" guarantee
// becomes two half-guarantees that race each other.
//
// The cost is that a visitor who is already inside the alert window still gets
// a fresh sentence on each poll rather than one frozen sentence. That is a few
// hundred milliseconds of Groq on the one endpoint where somebody is watching
// the screen, and it means the wording always matches the current numbers.

import { getQueue, getRecentServiceDurations, getVisitor, listActiveVisitors } from "@/lib/db";
import { generateVisitorMessage } from "@/lib/ai";
import { predictForVisitor } from "@/lib/prediction";
import { ok, fail, run } from "@/lib/respond";
import { DbError } from "@/lib/db";

export async function GET(request: Request) {
  return run(async () => {
    const visitorId = new URL(request.url).searchParams.get("visitorId");
    if (!visitorId) return fail("visitorId is required");

    // The spec names this exact string, and it is the one the visitor screen
    // shows, so we do not fall through to run()'s generic "not found".
    let visitor;
    try {
      visitor = await getVisitor(visitorId);
    } catch (error) {
      if ((error as DbError).code === "PGRST116") {
        return fail("Visitor not found", 404);
      }
      throw error;
    }

    const queue = await getQueue(visitor.queueId);

    // Finished visitors get a plain answer. No queue maths needed.
    // queueName is still returned so the field is never missing, even though
    // the frontend has no reason to show it on the "thanks" screen.
    if (visitor.status === "served" || visitor.status === "cancelled") {
      return ok({
        visitorId: visitor.id,
        ticketNo: visitor.ticketNo,
        name: visitor.name,
        status: visitor.status,
        queueName: queue.name,
        position: null,
        peopleAhead: null,
        minMinutes: null,
        maxMinutes: null,
        shouldAlert: false,
        alerted: visitor.alerted,
        message: null,
      });
    }

    const active = await listActiveVisitors(queue.id);
    const recent = await getRecentServiceDurations(queue.id);
    const estimate = predictForVisitor(visitor, active, recent, queue);

    // Once staff have called you, you are at the desk. Waiting is over, so say
    // so regardless of how many people are nominally ahead.
    const called = visitor.status === "called";
    const shouldAlert = called || estimate.shouldAlert;

    // A fixed phrase rather than a model call. This is the highest-stakes moment
    // in the whole flow and there is exactly one right sentence for it, so
    // spending 4 seconds of Groq latency to be slightly warmer is a bad trade.
    if (called) {
      return ok({
        visitorId: visitor.id,
        ticketNo: visitor.ticketNo,
        name: visitor.name,
        status: visitor.status,
        queueName: queue.name,
        // 0, not 1. You are not first in line any more, you are off the line.
        position: 0,
        peopleAhead: 0,
        minMinutes: 0,
        maxMinutes: 0,
        shouldAlert: true,
        alerted: visitor.alerted,
        message: "Please come to the desk.",
      });
    }

    // Only inside the alert window does the visitor get a written sentence. An
    // ordinary wait is just numbers on a screen, and a model call on every poll
    // for every visitor would be both slow and pointless.
    let message: string | null = null;

    if (estimate.shouldAlert) {
      const generated = await generateVisitorMessage({
        position: estimate.position,
        minMinutes: estimate.minMinutes,
        maxMinutes: estimate.maxMinutes,
        type: "alert",
      });
      message = generated.message;
    }

    return ok({
      visitorId: visitor.id,
      ticketNo: visitor.ticketNo,
      name: visitor.name,
      status: visitor.status,
      queueName: queue.name,
      position: estimate.position,
      peopleAhead: estimate.peopleAhead,
      minMinutes: estimate.minMinutes,
      maxMinutes: estimate.maxMinutes,
      shouldAlert,
      alerted: visitor.alerted,
      message,
    });
  });
}