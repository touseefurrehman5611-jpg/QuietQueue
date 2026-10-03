import { fetchOrThrow, getServiceClient, isUuid } from '@/lib/server/queue';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const visitorId = searchParams.get('visitorId');

  if (!visitorId) {
    return new Response(JSON.stringify({ error: 'Visitor ID required' }), { status: 400 });
  }

  // Reject malformed ids here; otherwise Postgres raises an invalid-uuid error
  // and the caller gets a 500 for what is really bad input.
  if (!isUuid(visitorId)) {
    return new Response(JSON.stringify({ error: 'Visitor ID must be a valid UUID' }), { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    const visitor = await fetchOrThrow(
      supabase.from('visitors').select('*').eq('id', visitorId).maybeSingle(),
      'Failed to load visitor'
    );

    if (!visitor) {
      return new Response(JSON.stringify({ error: 'Visitor not found' }), { status: 404 });
    }

    const allWaiting = await fetchOrThrow(
      supabase
        .from('visitors')
        .select('id, joined_at')
        .eq('queue_id', visitor.queue_id)
        .eq('status', 'waiting')
        .order('joined_at', { ascending: true }),
      'Failed to load queue'
    );

    // A visitor who is no longer 'waiting' is not in this list, so fall back to
    // position 1 rather than reporting the 0 that findIndex would produce.
    const waiting = allWaiting ?? [];
    const foundAt = waiting.findIndex((v) => v.id === visitor.id);
    const position = foundAt === -1 ? 1 : foundAt + 1;
    const totalWaiting = Math.max(waiting.length, position);

    const queue = await fetchOrThrow(
      supabase.from('queues').select('*').eq('id', visitor.queue_id).maybeSingle(),
      'Failed to load queue settings'
    );

    const recentEvents = await fetchOrThrow(
      supabase
        .from('service_events')
        .select('duration_seconds')
        .eq('queue_id', visitor.queue_id)
        .order('created_at', { ascending: false })
        .limit(5),
      'Failed to load service history'
    );

    let avgServiceSeconds = queue?.avg_service_seconds || 300;
    if (recentEvents && recentEvents.length > 0) {
      avgServiceSeconds = recentEvents.reduce((sum, e) => sum + e.duration_seconds, 0) / recentEvents.length;
    }

    const estimatedWaitSeconds = (position - 1) * avgServiceSeconds;
    const minMinutes = Math.max(0, Math.round((estimatedWaitSeconds * 0.8) / 60));
    const maxMinutes = Math.round((estimatedWaitSeconds * 1.2) / 60);

    const alertAt = queue?.alert_at_position || 3;
    const alerted = position <= alertAt && visitor.status === 'waiting';

    return new Response(
      JSON.stringify({
        visitorId: visitor.id,
        ticketNo: visitor.ticket_no,
        position,
        totalWaiting,
        status: visitor.status,
        minMinutes,
        maxMinutes,
        alerted,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('status failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}