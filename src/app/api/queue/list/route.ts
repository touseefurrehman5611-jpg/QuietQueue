import { getServiceClient, resolveQueueId } from '@/lib/server/queue';

export async function GET() {
  try {
    const supabase = getServiceClient();
    const queueId = await resolveQueueId(supabase);

    const { data: visitors, error } = await supabase
      .from('visitors')
      .select('*')
      .eq('queue_id', queueId)
      .order('joined_at', { ascending: true });

    if (error) throw new Error(`Failed to load visitors: ${error.message}`);

    const served = (visitors ?? []).filter((v) => v.status === 'served');
    const avgWait = served.reduce((sum, v) => {
      if (v.served_at && v.joined_at) {
        return sum + (new Date(v.served_at).getTime() - new Date(v.joined_at).getTime()) / 1000;
      }
      return sum;
    }, 0);

    return new Response(
      JSON.stringify({ visitors: visitors ?? [], avgWait, servedCount: served.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('list failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}