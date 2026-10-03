import { v4 as uuidv4 } from 'uuid';
import { fetchOrThrow, getServiceClient, resolveQueueId } from '@/lib/server/queue';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = body.name?.trim();
    const phone = body.phone?.trim() || null;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Name is required' }), { status: 400 });
    }

    const supabase = getServiceClient();
    const queueId = await resolveQueueId(supabase);

    const ticketNo = Math.floor(100000 + Math.random() * 900000);
    const visitorId = uuidv4();

    await fetchOrThrow(
      supabase.from('visitors').insert({
        id: visitorId,
        queue_id: queueId,
        ticket_no: ticketNo,
        name,
        phone,
        status: 'waiting',
        joined_at: new Date().toISOString(),
      }),
      'Failed to join queue'
    );

    return new Response(
      JSON.stringify({ visitorId, ticketNo, queueId }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('join failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}