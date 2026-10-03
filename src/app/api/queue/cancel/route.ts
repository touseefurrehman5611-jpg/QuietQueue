import { getServiceClient, isUuid, readJsonBody } from '@/lib/server/queue';

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

    // Only waiting or called visitors can be cancelled; otherwise a stale
    // request could overwrite an already-served record.
    const { data: cancelled, error } = await supabase
      .from('visitors')
      .update({ status: 'cancelled' })
      .eq('id', visitorId)
      .in('status', ['waiting', 'called'])
      .select('id');

    if (error) throw new Error(`Failed to cancel visitor: ${error.message}`);

    if (!cancelled || cancelled.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Visitor not found or already closed' }),
        { status: 404 }
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('cancel failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}