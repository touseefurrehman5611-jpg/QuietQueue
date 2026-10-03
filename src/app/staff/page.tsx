'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Visitor } from '@/types';
import { useToast } from '@/components/ToastProvider';
import { EmptyState } from '@/components/EmptyState';

// Phone is free-text from the join form, so strip everything that is illegal in
// a tel: URI before building the href. Returns null when nothing dialable is left.
function toTelHref(phone: string): string | null {
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  return `tel:${cleaned}`;
}

export default function StaffPage() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [stats, setStats] = useState({ avgWait: 0, servedCount: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const fetchVisitors = useCallback(async () => {
    try {
      const res = await fetch('/api/queue/list');
      if (!res.ok) throw new Error('list failed');
      const data = await res.json();
      setVisitors(data.visitors || []);
      setStats({ avgWait: data.avgWait ?? 0, servedCount: data.servedCount ?? 0 });
    } catch {
      toast.error('Could not load the queue. Retrying shortly.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // The effect's job is to subscribe, not to set state. The first load is
    // deferred to a task so it never lands synchronously inside the effect
    // body, which would force a cascading render on mount.
    const initial = setTimeout(fetchVisitors, 0);

    // Realtime is a bonus on top of the 5s poll, so a null client (missing
    // env vars) must degrade to polling-only instead of throwing.
    const channel = supabase
      ? supabase
          .channel('staff-queue')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'visitors' }, () => {
            fetchVisitors();
          })
          .subscribe()
      : null;

    const poll = setInterval(fetchVisitors, 5000);
    return () => {
      clearTimeout(initial);
      if (channel) supabase?.removeChannel(channel);
      clearInterval(poll);
    };
  }, [fetchVisitors]);

  const runAction = useCallback(
    async (options: { url: string; body?: unknown; success: string; failure: string; id?: string }) => {
      setBusyId(options.id ?? 'global');
      try {
        const res = await fetch(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body ?? {}),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast.error(data.error ?? options.failure);
          return false;
        }
        toast.success(options.success);
        await fetchVisitors();
        return true;
      } catch {
        toast.error('Network problem. Please try again.');
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [fetchVisitors, toast]
  );

  const handleCallNext = useCallback(async () => {
    const ok = await runAction({
      url: '/api/queue/next',
      success: 'Next visitor has been called.',
      failure: 'Could not call the next visitor.',
    });
    if (!ok && !visitors.some((v) => v.status === 'waiting')) {
      toast.info('The waiting list is empty right now.');
    }
  }, [runAction, toast, visitors]);

  const handleDone = useCallback(
    (id: string) =>
      runAction({
        url: '/api/queue/done',
        body: { visitorId: id },
        success: 'Visitor marked as served.',
        failure: 'Could not mark this visitor as served.',
        id,
      }),
    [runAction]
  );

  const handleCancel = useCallback(
    (id: string) =>
      runAction({
        url: '/api/queue/cancel',
        body: { visitorId: id },
        success: 'Visitor cancelled.',
        failure: 'Could not cancel this visitor.',
        id,
      }),
    [runAction]
  );

  const handleSimulate = useCallback(
    () =>
      runAction({
        url: '/api/demo/simulate',
        success: 'Sample visitors added to the queue.',
        failure: 'Could not simulate visitors.',
      }),
    [runAction]
  );

  const waitingVisitors = visitors.filter((v) => v.status === 'waiting');
  const calledVisitors = visitors.filter((v) => v.status === 'called');

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 p-4">
      {!isSupabaseConfigured && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to load live data and realtime updates.
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Staff Dashboard</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCallNext}
            disabled={busyId !== null || waitingVisitors.length === 0}
            className="flex-1 rounded-md bg-green-600 px-4 py-2 font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            Call Next
          </button>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={busyId !== null}
            className="flex-1 rounded-md bg-purple-600 px-4 py-2 font-medium text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            Simulate
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Waiting" value={waitingVisitors.length} />
        <StatCard label="Average Wait (min)" value={Math.round(stats.avgWait / 60) || 0} />
        <StatCard label="Served" value={stats.servedCount} />
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-orange-600">
            Called{calledVisitors.length > 0 && ` (${calledVisitors.length})`}
          </h2>
          {calledVisitors.length === 0 ? (
            <EmptyState
              icon="called"
              title="Nobody is at the desk"
              description="Call Next to bring the first person in the waiting list forward."
            />
          ) : (
            <div className="space-y-2">
              {calledVisitors.map((visitor) => (
                <VisitorRow
                  key={visitor.id}
                  visitor={visitor}
                  busy={busyId === visitor.id}
                  actions={
                    <>
                      <ActionButton
                        tone="green"
                        onClick={() => handleDone(visitor.id)}
                        disabled={busyId !== null}
                      >
                        Mark Done
                      </ActionButton>
                      <ActionButton
                        tone="red"
                        onClick={() => handleCancel(visitor.id)}
                        disabled={busyId !== null}
                      >
                        Cancel
                      </ActionButton>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold">
            Waiting List{waitingVisitors.length > 0 && ` (${waitingVisitors.length})`}
          </h2>
          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading queue">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : waitingVisitors.length === 0 ? (
            <EmptyState
              title="No one is waiting"
              description="New visitors appear here automatically the moment they join."
              action={
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={busyId !== null}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add sample visitors
                </button>
              }
            />
          ) : (
            <div className="space-y-2">
              {waitingVisitors.map((visitor, index) => (
                <VisitorRow
                  key={visitor.id}
                  visitor={visitor}
                  busy={busyId === visitor.id}
                  meta={`Position ${index + 1}`}
                  actions={
                    <>
                      {index === 0 && (
                        <ActionButton
                          tone="green"
                          onClick={handleCallNext}
                          disabled={busyId !== null}
                        >
                          Call
                        </ActionButton>
                      )}
                      <ActionButton
                        tone="red"
                        onClick={() => handleCancel(visitor.id)}
                        disabled={busyId !== null}
                      >
                        Cancel
                      </ActionButton>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function VisitorRow({
  visitor,
  meta,
  busy,
  actions,
}: {
  visitor: Visitor;
  meta?: string;
  busy: boolean;
  actions: React.ReactNode;
}) {
  const telHref = visitor.phone ? toTelHref(visitor.phone) : null;

  return (
    <div className={`rounded-lg p-4 shadow-sm transition ${busy ? 'opacity-60' : 'bg-white'}`}>
      {/* Column on narrow screens so long names and buttons never collide. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-bold">
            #{visitor.ticket_no} &middot; {visitor.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
            {meta && <span>{meta}</span>}
            <span>Status: {visitor.status}</span>
            {telHref && (
              <a
                href={telHref}
                className="inline-flex items-center gap-1 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.8.7a2 2 0 011.7 2z" />
                </svg>
                {visitor.phone}
              </a>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">{actions}</div>
      </div>
    </div>
  );
}

function ActionButton({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: 'green' | 'red';
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const tones = {
    green: 'bg-green-600 hover:bg-green-700',
    red: 'bg-red-600 hover:bg-red-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-md px-3 py-1 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none ${tones[tone]}`}
    >
      {children}
    </button>
  );
}