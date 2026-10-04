import { v4 as uuidv4 } from 'uuid';
import { fetchOrThrow, getServiceClient, resolveQueueId } from '@/lib/server/queue';

const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack'];

export async function POST() {
  try {
    const supabase = getServiceClient();
    const queueId = await resolveQueueId(supabase);

    const count = 5 + Math.floor(Math.random() * 5);
    const now = Date.now();

    const rows = Array.from({ length: count }, (_, i) => ({
      id: uuidv4(),
      queue_id: queueId,
      ticket_no: Math.floor(100000 + Math.random() * 900000),
      name: `${NAMES[i % NAMES.length]} ${i + 1}`,
      status: 'waiting',
      joined_at: new Date(now - i * 60000).toISOString(),
    }));

    // Previously each insert was awaited without checking its error, so a broken
    // configuration still answered { success: true, count } with nothing stored.
    await fetchOrThrow(supabase.from('visitors').insert(rows), 'Failed to simulate visitors');

    return new Response(JSON.stringify({ success: true, count }), { status: 200 });
  } catch (error) {
    console.error('simulate failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}