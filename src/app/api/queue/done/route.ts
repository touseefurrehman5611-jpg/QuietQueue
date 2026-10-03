import { fetchOrThrow, getServiceClient, isUuid, readJsonBody } from '@/lib/server/queue';

// A single instant "service" would otherwise drag the rolling average down to ~0
// and make every wait estimate read as zero minutes.
const MIN_AVG_SERVICE_SECONDS = 60;
const FALLBACK_SERVICE_SECONDS = 300;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const visitorId = body?.visitorId;

    if (!visitorId) {
      return new Response(JSON.stringify({ error: 'Visitor ID required' }), { status: 400 });
    }

    // Guard against malformed ids: a uuid column would otherwise make Postgres
    // fail with an invalid-uuid error, which surfaces as a misleading 500.
    if (!isUuid(visitorId)) {
      return new Response(JSON.stringify({ error: 'Visitor ID must be a valid UUID' }), { status: 400 });
    }

    const supabase = getServiceClient();

    const visitor = await fetchOrThrow(
      supabase.from('visitors').select('*').eq('id', visitorId).maybeSingle(),
      'Failed to load visitor'
    );

    if (!visitor) {
      return new Response(JSON.stringify({ error: 'Visitor not found' }), { status: 404 });
    }

    const now = new Date();
    const calledAt = visitor.called_at ? new Date(visitor.called_at) : now;
    const elapsed = Math.round((now.getTime() - calledAt.getTime()) / 1000);
    const actualDuration = elapsed > 0 ? elapsed : FALLBACK_SERVICE_SECONDS;

    await fetchOrThrow(
      supabase.from('service_events').insert({
        queue_id: visitor.queue_id,
        visitor_id: visitor.id,
        duration_seconds: actualDuration,
        created_at: now.toISOString(),
      }),
      'Failed to record service event'
    );

    await fetchOrThrow(
      supabase
        .from('visitors')
        .update({ status: 'served', served_at: now.toISOString() })
        .eq('id', visitorId),
      'Failed to mark visitor served'
    );

    const recentEvents = await fetchOrThrow(
      supabase
        .from('service_events')
        .select('duration_seconds')
        .eq('queue_id', visitor.queue_id)
        .order('created_at', { ascending: false })
        .limit(5),
      'Failed to load recent service events'
    );

    if (recentEvents && recentEvents.length > 0) {
      const avg = recentEvents.reduce((sum, e) => sum + e.duration_seconds, 0) / recentEvents.length;
      await fetchOrThrow(
        supabase
          .from('queues')
          .update({ avg_service_seconds: Math.max(MIN_AVG_SERVICE_SECONDS, Math.round(avg)) })
          .eq('id', visitor.queue_id),
        'Failed to update average service time'
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('done failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}