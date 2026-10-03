import { getServiceClient, resolveQueueId } from '@/lib/server/queue';

export async function POST() {
  try {
    const supabase = getServiceClient();
    const queueId = await resolveQueueId(supabase);

    const { data: next, error } = await supabase
      .from('visitors')
      .select('*')
      .eq('queue_id', queueId)
      .eq('status', 'waiting')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to find next visitor: ${error.message}`);
    if (!next) {
      return new Response(JSON.stringify({ error: 'No one waiting' }), { status: 400 });
    }

    const calledAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('visitors')
      .update({ status: 'called', called_at: calledAt })
      .eq('id', next.id)
      .eq('status', 'waiting');

    if (updateError) throw new Error(`Failed to call visitor: ${updateError.message}`);

    // Return the updated row rather than the pre-update snapshot, so the client
    // does not render a 'called' visitor as still waiting.
    return new Response(
      JSON.stringify({ success: true, visitor: { ...next, status: 'called', called_at: calledAt } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('next failed:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}