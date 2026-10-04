// Who gets told they are nearly up.
//
// The alert window is not a timer and it is not "the first N who joined". It is
// a moving set: everybody standing within `alertAtPosition` people of the front
// of the queue. Call someone, serve them, cancel them, and a different set of
// people is now inside that window. That is why this runs after every `next`,
// `done` and `cancel` rather than once on join.
//
// Nothing here decides policy. prediction.ts owns "is this person close
// enough" and db.ts owns every read and write. This file only applies that
// policy to the list of people currently waiting.

import {
  getQueue,
  getRecentServiceDurations,
  listActiveVisitors,
  markAlerted,
} from "./db";
import { waitEstimate } from "./prediction";
import type { Visitor } from "./types";

// Work out who has just crossed into the alert window, and record that we told
// them. Returns ONLY the people newly alerted by this call, so the caller can
// send exactly those notifications and nothing else.
//
// THE RULE: a visitor is never alerted twice. That is not a promise this
// function keeps in memory, it is a promise the `alerted` column keeps in the
// database. We filter on `alerted === false`, then immediately write `true`.
// The write is durable, so a later call re-reads the row, sees `true`, and skips
// them. That survives a process restart, a redeploy and a second server, which
// an in-memory Set would not.
//
// ponytail: the filter-then-write is not atomic. Two calls at the same instant
// could both read alerted = false and both write true, alerting one person
// twice. The real fix is to make the write conditional and trust the row count:
//   update visitors set alerted = true where id = $1 AND alerted = false
// then treat a returned count of 0 as "someone else already claimed them".
// Not implemented on purpose: this is a single-user staff demo, staff do not
// double-tap `next`, and building the harder version now is wasted work. Revisit
// the day two staff phones can call the same endpoint for the same queue.
export async function checkAndMarkAlerts(queueId: string): Promise<Visitor[]> {
  const queue = await getQueue(queueId);
  const visitors = await listActiveVisitors(queueId);
  const recentDurations = await getRecentServiceDurations(queueId);

  const newlyAlerted: Visitor[] = [];

  // listActiveVisitors is already ordered by ticket number, so the index IS the
  // position in line. A "called" visitor still counts as someone ahead of you
  // until they are served, which is why we count every visitor but only alert
  // the ones still waiting.
  for (const [index, visitor] of visitors.entries()) {
    if (visitor.status !== "waiting") continue;
    if (visitor.alerted) continue;

    const estimate = waitEstimate(index, queue, recentDurations);
    if (!estimate.shouldAlert) continue;

    // Write first, then report. If the database refuses, we throw instead of
    // telling somebody they are nearly up when we failed to record it: a
    // duplicate alert is a much smaller problem than a repeated one forever.
    await markAlerted(visitor.id);
    newlyAlerted.push(visitor);
  }

  // Marking `alerted` changes a row in a table the frontend is subscribed to,
  // so Supabase Realtime pushes the new value out on its own. That is why the
  // frontend needs no polling loop for alerts specifically -- the column write
  // here IS the notification.
  return newlyAlerted;
}

// Placeholder for Twilio. Deliberately a stub: SMS is not part of this demo, and
// wiring a real sender now would mean holding credentials we do not use yet.
// Replace the log with the Twilio call and keep this exact signature so no
// caller has to change.
//
// The phone check lives here on purpose. `phone` is nullable on the visitor, and
// making every caller remember to guard it is how one of them forgets.
export function sendSmsAlert(phone: string | null, text: string): void {
  if (!phone?.trim()) return;
  console.log(`[quietqueue] sms to ${phone}: ${text}`);
}
