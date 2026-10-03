import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_AVG_SERVICE_SECONDS = 300;
const DEFAULT_ALERT_AT_POSITION = 3;

/**
 * Server-side Supabase client using the service role key.
 *
 * Throws instead of constructing a client with empty credentials: the routes use
 * the service key, so a missing value produces a confusing "supabaseUrl is
 * required" deep inside the driver rather than a clear config error.
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Resolves which queue the routes should operate on.
 *
 * Every route previously duplicated this logic and most of them used
 * `limit(1)` with no ordering, so they silently disagreed about which queue was
 * "the" queue. `maybeSingle` also avoids the error that `single` raises once a
 * second queue exists, which used to make callers create a fresh queue each time.
 */
export async function resolveQueueId(supabase: SupabaseClient): Promise<string> {
  const configured = process.env.DEFAULT_QUEUE_ID;
  if (configured) return configured;

  const { data: existing, error } = await supabase
    .from('queues')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load queue: ${error.message}`);
  }
  if (existing) return existing.id;

  const id = uuidv4();
  const { error: insertError } = await supabase.from('queues').insert({
    id,
    name: 'Main Queue',
    avg_service_seconds: DEFAULT_AVG_SERVICE_SECONDS,
    alert_at_position: DEFAULT_ALERT_AT_POSITION,
  });

  if (insertError) {
    throw new Error(`Failed to create queue: ${insertError.message}`);
  }
  return id;
}

/** Reads a row, throwing when the query failed so callers cannot ignore it. */
export async function fetchOrThrow<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
  context: string
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
  return data;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards visitor IDs before they reach Postgres.
 *
 * `visitors.id` is a uuid column, so a malformed value makes PostgREST fail with
 * an `invalid input syntax for type uuid` error. That used to surface as a 500,
 * which reads like a server fault when the real problem is bad client input.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Parses a JSON body, returning null instead of throwing on malformed input. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}