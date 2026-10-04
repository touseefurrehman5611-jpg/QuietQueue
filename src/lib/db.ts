// Every database read and write in one place.
//
// These helpers only move data in and out. They do NOT decide anything:
// validation lives in validate.ts, wait math lives in prediction.ts, and the
// routes decide what to call. Every function throws a readable Error if
// Supabase fails, so a route can catch it and answer with fail().
//
// Column names are snake_case in the database and camelCase in TypeScript,
// so each row gets mapped on the way out.

import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabaseServer";
import type { Queue, ServiceEvent, Visitor, VisitorStatus } from "./types";

// Postgres error code for a duplicate key. We use it to retry a ticket number.
const DUPLICATE_KEY = "23505";

// An Error that also carries the Postgres code, so a route can tell "not
// found" (PGRST116) from a real failure without matching on the message text.
export type DbError = Error & { code?: string };

// Turn a Supabase error into something a human can act on. Postgres puts the
// actual fix in `hint` far more often than in `message`, so we show both.
function dbError(error: PostgrestError | null, action: string): never {
  const parts = [`${action}: ${error?.message ?? "unknown error"}`];
  if (error?.hint) parts.push(`hint: ${error.hint}`);
  if (error?.code) parts.push(`code: ${error.code}`);

  const err = new Error(parts.join(" | ")) as DbError;
  err.code = error?.code ?? undefined;
  throw err;
}

// The raw row shapes we get back from Supabase.
type QueueRow = {
  id: string;
  name: string;
  avg_service_seconds: number;
  alert_at_position: number;
  speed_multiplier: number;
  created_at: string;
};

type VisitorRow = {
  id: string;
  queue_id: string;
  ticket_no: number;
  name: string;
  status: VisitorStatus;
  alerted: boolean;
  joined_at: string;
  called_at: string | null;
  served_at: string | null;
};

type ServiceEventRow = {
  id: string;
  queue_id: string;
  visitor_id: string;
  duration_seconds: number;
  created_at: string;
};

function rowToQueue(row: QueueRow): Queue {
  return {
    id: row.id,
    name: row.name,
    avgServiceSeconds: row.avg_service_seconds,
    alertAtPosition: row.alert_at_position,
    speedMultiplier: row.speed_multiplier,
    createdAt: row.created_at,
  };
}

// `phone` is absent on purpose. It is not a column on `visitors` any more (see
// 002_phone_split.sql), so a plain row read cannot carry it. listActiveVisitors
// attaches it separately, for the staff screen only.
function rowToVisitor(row: VisitorRow): Visitor {
  return {
    id: row.id,
    queueId: row.queue_id,
    ticketNo: row.ticket_no,
    name: row.name,
    status: row.status,
    alerted: row.alerted,
    joinedAt: row.joined_at,
    calledAt: row.called_at,
    servedAt: row.served_at,
  };
}

function rowToServiceEvent(row: ServiceEventRow): ServiceEvent {
  return {
    id: row.id,
    queueId: row.queue_id,
    visitorId: row.visitor_id,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
  };
}

// One queue by its id.
export async function getQueue(queueId: string): Promise<Queue> {
  const { data, error } = await getSupabaseAdmin()
    .from("queues")
    .select("*")
    .eq("id", queueId)
    .single();

  if (error) dbError(error, `could not load queue ${queueId}`);
  return rowToQueue(data as QueueRow);
}

// Change how fast the desk is working. The 0.25 to 4 range is checked by
// toSpeed() in validate.ts and again by a CHECK constraint in the database.
export async function updateQueueSpeed(
  queueId: string,
  speedMultiplier: number,
): Promise<Queue> {
  const { data, error } = await getSupabaseAdmin()
    .from("queues")
    .update({ speed_multiplier: speedMultiplier })
    .eq("id", queueId)
    .select()
    .single();

  if (error) dbError(error, `could not update speed for queue ${queueId}`);
  return rowToQueue(data as QueueRow);
}

// The ticket number the next visitor should get: one past the highest we have.
// Returns 1 for an empty queue.
export async function getNextTicketNo(queueId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .select("ticket_no")
    .eq("queue_id", queueId)
    .order("ticket_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) dbError(error, `could not read ticket numbers for queue ${queueId}`);
  return data ? data.ticket_no + 1 : 1;
}

// Add a visitor to a queue.
//
// Reading the max ticket and inserting are two separate steps, so two visitors
// joining at the same instant can pick the same number. The database has a
// UNIQUE rule that refuses the second one, so we catch that and try again.
//
// ponytail: N attempts survive N concurrent joins. Each round of a burst has
// exactly one winner, so with k people arriving in the same tick you need k
// attempts. Three was measured to be too few: five simultaneous joins left two
// of them with a 500, because five people need five attempts and three ran out
// first. It was raised to 8 to leave real headroom over the five-join burst the
// smoke test exercises. Do not lower it back to 3 on the strength of an older
// reading of this comment. The real fix is a Postgres sequence per queue and
// dropping the read-then-insert entirely.
const MAX_TICKET_ATTEMPTS = 8;

export async function createVisitor(
  queueId: string,
  name: string,
  phone: string | null = null,
): Promise<Visitor> {
  // Each retry re-reads the max, so a retry after a collision is a genuinely
  // different number rather than the same guess again.
  for (let attempt = 0; attempt < MAX_TICKET_ATTEMPTS; attempt++) {
    const ticketNo = await getNextTicketNo(queueId);

    // No phone here. It moved to `visitor_phones` in migration 002, and writing
    // it separately means the publicly readable `visitors` table never holds a
    // phone number at all -- not even for the moment between two writes.
    const { data, error } = await getSupabaseAdmin()
      .from("visitors")
      .insert({ queue_id: queueId, name, ticket_no: ticketNo })
      .select()
      .single();

    if (!error) {
      const visitor = rowToVisitor(data as VisitorRow);

      // Phone is optional, so most joins skip this second write entirely.
      if (phone !== null) await setVisitorPhone(visitor.id, phone);

      return visitor;
    }

    // Someone else took that ticket number between our read and our insert.
    // Keep trying while we are out of attempts.
    if (error.code === DUPLICATE_KEY && attempt < MAX_TICKET_ATTEMPTS - 1) continue;

    dbError(error, `could not add visitor to queue ${queueId}`);
  }

  // Only reachable if the loop finished without returning or throwing.
  throw new Error(`could not add visitor to queue ${queueId}`);
}

// One visitor by their id. Throws if there is no such visitor, so the route
// can answer 404 instead of crashing.
export async function getVisitor(visitorId: string): Promise<Visitor> {
  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .select("*")
    .eq("id", visitorId)
    .single();

  if (error) dbError(error, `could not load visitor ${visitorId}`);
  return rowToVisitor(data as VisitorRow);
}

// Everyone still in the queue, oldest ticket first. Staff see this list.
export async function listActiveVisitors(queueId: string): Promise<Visitor[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .select("*")
    .eq("queue_id", queueId)
    .in("status", ["waiting", "called"])
    .order("ticket_no", { ascending: true });

  if (error) dbError(error, `could not list visitors for queue ${queueId}`);
  return (data as VisitorRow[]).map(rowToVisitor);
}

// Move a visitor to a new status, and stamp the matching time.
// Pass calledAt when they are called, servedAt when they are finished.
//
// Always pass servedAt when the status is "served", otherwise getStats cannot
// count that visitor.
export async function setVisitorStatus(
  visitorId: string,
  status: VisitorStatus,
  timestamps?: { calledAt?: string | null; servedAt?: string | null },
): Promise<Visitor> {
  const patch: Record<string, unknown> = { status };
  if (timestamps?.calledAt !== undefined) patch.called_at = timestamps.calledAt;
  if (timestamps?.servedAt !== undefined) patch.served_at = timestamps.servedAt;

  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .update(patch)
    .eq("id", visitorId)
    .select()
    .single();

  if (error) dbError(error, `could not set visitor ${visitorId} to ${status}`);
  return rowToVisitor(data as VisitorRow);
}

// Remember that we already told this visitor they are nearly up, so we do not
// send the alert twice.
export async function markAlerted(visitorId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("visitors")
    .update({ alerted: true })
    .eq("id", visitorId);

  if (error) dbError(error, `could not mark visitor ${visitorId} as alerted`);
}

// Store a visitor's phone number.
//
// This table has NO anon read policy on purpose (002_phone_split.sql), so the
// only role that can read it back is the service role -- which is to say, only
// our own server. A visitor's phone number is contact data, and the frontend
// needs it for exactly one screen: the staff list.
//
// Upsert rather than insert, so calling this twice for one visitor replaces the
// number instead of colliding on the primary key.
export async function setVisitorPhone(visitorId: string, phone: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("visitor_phones")
    .upsert({ visitor_id: visitorId, phone });

  if (error) dbError(error, `could not save the phone number for visitor ${visitorId}`);
}

// Read back a set of phone numbers, keyed by visitor id.
//
// Only GET /api/queue/list calls this, and that route is staff-gated by
// auth.ts. Everywhere else in the app goes without a phone number entirely.
//
// One extra round trip on the staff list, and only that route pays it. Returns
// an empty map rather than throwing when there is nothing stored, so the common
// case (most visitors gave no number) costs no special handling at the call site.
export async function getVisitorPhones(
  visitorIds: string[],
): Promise<Map<string, string>> {
  const phones = new Map<string, string>();

  // An empty .in() is an error in PostgREST, so short-circuit before querying.
  if (visitorIds.length === 0) return phones;

  const { data, error } = await getSupabaseAdmin()
    .from("visitor_phones")
    .select("visitor_id, phone")
    .in("visitor_id", visitorIds);

  if (error) dbError(error, "could not load visitor phone numbers");

  for (const row of (data as { visitor_id: string; phone: string }[]) ?? []) {
    phones.set(row.visitor_id, row.phone);
  }

  return phones;
}

// Record how long one visit really took. These rows are what make the
// prediction adapt to how the desk is actually moving.
//
// The column is an integer, so we round here rather than let Postgres reject a
// decimal with a confusing "invalid input syntax" error.
export async function addServiceEvent(
  queueId: string,
  visitorId: string,
  durationSeconds: number,
): Promise<ServiceEvent> {
  const { data, error } = await getSupabaseAdmin()
    .from("service_events")
    .insert({
      queue_id: queueId,
      visitor_id: visitorId,
      duration_seconds: Math.max(0, Math.round(durationSeconds)),
    })
    .select()
    .single();

  if (error) dbError(error, `could not save service time for visitor ${visitorId}`);
  return rowToServiceEvent(data as ServiceEventRow);
}

// The most recent service times in seconds, newest first. Used to average out
// how fast the desk is really working.
export async function getRecentServiceDurations(
  queueId: string,
  limit = 5,
): Promise<number[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("service_events")
    .select("duration_seconds")
    .eq("queue_id", queueId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) dbError(error, `could not read service times for queue ${queueId}`);
  return (data as { duration_seconds: number }[]).map((r) => r.duration_seconds);
}

// Three numbers for the staff dashboard: how many we have finished, how long
// they waited on average, and how long the desk took them on average.
//
// servedCount counts everyone with status "served". avgWaitMinutes only uses
// the ones that actually have a served_at time, because a visitor marked served
// without a timestamp still counts as served but has no wait to measure.
//
// avgServiceMinutes comes from service_events rather than the visitor rows,
// because a simulated demo visit (simulatedSeconds) is recorded there and would
// be missing from a called_at -> served_at measurement.
//
// Both averages are null when there is nothing to measure, so the dashboard can
// say "no data yet" instead of showing a fake zero.
// ponytail: averages in JS after fetching the timestamps. Postgres cannot average
// joined_at -> served_at through PostgREST without a database function. If the
// served row count ever gets large, move this into a Postgres view.
export async function getStats(
  queueId: string,
): Promise<{
  servedCount: number;
  avgWaitMinutes: number | null;
  avgServiceMinutes: number | null;
}> {
  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .select("joined_at, served_at")
    .eq("queue_id", queueId)
    .eq("status", "served");

  if (error) dbError(error, `could not read stats for queue ${queueId}`);

  const rows = data as { joined_at: string; served_at: string | null }[];
  const servedCount = rows.length;

  // Only the rows we can actually measure.
  const timed = rows.filter((row) => row.served_at !== null);

  let avgWaitMinutes: number | null = null;

  if (timed.length > 0) {
    const totalMinutes = timed.reduce((sum, row) => {
      const waitedMs =
        new Date(row.served_at as string).getTime() - new Date(row.joined_at).getTime();
      return sum + waitedMs / 60000;
    }, 0);

    // One decimal place is plenty for a wait time and keeps the UI calm.
    avgWaitMinutes = Math.round((totalMinutes / timed.length) * 10) / 10;
  }

  // A second, independent read. Not ideal, but the dashboard wants all three
  // numbers in one response and combining them here beats three round trips.
  const { data: events, error: eventsError } = await getSupabaseAdmin()
    .from("service_events")
    .select("duration_seconds")
    .eq("queue_id", queueId);

  if (eventsError) dbError(eventsError, `could not read service times for queue ${queueId}`);

  const durations = (events as { duration_seconds: number }[]).map(
    (r) => r.duration_seconds,
  );

  let avgServiceMinutes: number | null = null;

  if (durations.length > 0) {
    const totalSeconds = durations.reduce((sum, d) => sum + d, 0);
    avgServiceMinutes = Math.round((totalSeconds / durations.length / 60) * 10) / 10;
  }

  return { servedCount, avgWaitMinutes, avgServiceMinutes };
}