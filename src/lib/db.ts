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
  phone: string | null;
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

function rowToVisitor(row: VisitorRow): Visitor {
  return {
    id: row.id,
    queueId: row.queue_id,
    ticketNo: row.ticket_no,
    name: row.name,
    phone: row.phone,
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
// UNIQUE rule that refuses the second one, so we catch that and try once more.
export async function createVisitor(
  queueId: string,
  name: string,
  phone: string | null = null,
): Promise<Visitor> {
  // One retry. A second collision means something is genuinely wrong, and
  // looping again would just hammer the database.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ticketNo = await getNextTicketNo(queueId);

    const { data, error } = await getSupabaseAdmin()
      .from("visitors")
      .insert({ queue_id: queueId, name, phone, ticket_no: ticketNo })
      .select()
      .single();

    if (!error) return rowToVisitor(data as VisitorRow);

    // Someone else took that ticket number between our read and our insert.
    if (error.code === DUPLICATE_KEY && attempt === 0) continue;

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

// Two numbers for the staff dashboard: how many we have finished, and how long
// they waited on average from joining to being served.
//
// servedCount counts everyone with status "served". The average only uses the
// ones that actually have a served_at time, because a visitor marked served
// without a timestamp still counts as served but has no wait to measure.
//
// avgWaitMinutes is null when nobody has been served yet, so the dashboard can
// say "no data yet" instead of showing a fake zero.
// ponytail: averages in JS after fetching the timestamps. Postgres cannot average
// joined_at -> served_at through PostgREST without a database function. If the
// served row count ever gets large, move this into a Postgres view.
export async function getStats(
  queueId: string,
): Promise<{ servedCount: number; avgWaitMinutes: number | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("visitors")
    .select("joined_at, served_at")
    .eq("queue_id", queueId)
    .eq("status", "served");

  if (error) dbError(error, `could not read stats for queue ${queueId}`);

  const rows = data as { joined_at: string; served_at: string | null }[];
  if (rows.length === 0) return { servedCount: 0, avgWaitMinutes: null };

  // Only the rows we can actually measure.
  const timed = rows.filter((row) => row.served_at !== null);

  if (timed.length === 0) return { servedCount: rows.length, avgWaitMinutes: null };

  const totalMinutes = timed.reduce((sum, row) => {
    const waitedMs = new Date(row.served_at as string).getTime() - new Date(row.joined_at).getTime();
    return sum + waitedMs / 60000;
  }, 0);

  // One decimal place is plenty for a wait time and keeps the UI calm.
  const avgWaitMinutes = Math.round((totalMinutes / timed.length) * 10) / 10;

  return { servedCount: rows.length, avgWaitMinutes };
}