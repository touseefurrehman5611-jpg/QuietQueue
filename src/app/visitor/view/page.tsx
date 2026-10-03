'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface QueueStatus {
  visitorId: string;
  ticketNo: number;
  position: number;
  totalWaiting: number;
  status: 'waiting' | 'called' | 'served' | 'cancelled';
  minMinutes: number;
  maxMinutes: number;
  alerted: boolean;
}

const POLL_INTERVAL_MS = 10000;

export default function VisitorViewPage() {
  return (
    <Suspense
      fallback={
        <div className='flex flex-1 items-center justify-center p-4'>
          <p className='text-gray-500'>Loading...</p>
        </div>
      }
    >
      <VisitorStatus />
    </Suspense>
  );
}

function VisitorStatus() {
  const searchParams = useSearchParams();
  const visitorId = searchParams.get('visitorId');

  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const fetchedAlertFor = useRef<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!visitorId) return;

    try {
      const res = await fetch(`/api/queue/status?visitorId=${encodeURIComponent(visitorId)}`);
      if (res.status === 404) {
        setError('We could not find that visitor. Please check the link and try again.');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong loading your queue status.');
        return;
      }

      const data: QueueStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch {
      setError('Network problem. Retrying...');
    } finally {
      setLoading(false);
    }
  }, [visitorId]);

  useEffect(() => {
    // A missing visitorId is handled during render, so there is nothing to do here.
    if (!visitorId) return;

    (async () => {
      await fetchStatus();
    })();

    const poll = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);

    const client = supabase;
    const channel = client
      ?.channel(`visitor-${visitorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'visitors',
          filter: `id=eq.${visitorId}`,
        },
        () => void fetchStatus()
      )
      .subscribe();

    return () => {
      clearInterval(poll);
      if (client && channel) void client.removeChannel(channel);
    };
  }, [visitorId, fetchStatus]);

  // Ask for a friendly message once per alert, not on every poll.
  useEffect(() => {
    if (!status?.alerted || fetchedAlertFor.current === status.visitorId) return;

    fetchedAlertFor.current = status.visitorId;
    void (async () => {
      try {
        const res = await fetch('/api/ai/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: status.position }),
        });
        const data = await res.json();
        if (data.message) setAlertMessage(data.message);
      } catch {
        // A missing AI message is cosmetic; the banner below still renders.
      }
    })();
  }, [status]);

  if (!visitorId) {
    return (
      <Shell>
        <h1 className='mb-2 text-xl font-bold'>No visitor selected</h1>
        <p className='mb-6 text-gray-600'>
          This page needs a visitor ID. Join the queue first and you will get a link.
        </p>
        <Link
          href='/visitor'
          className='block w-full rounded-md bg-blue-600 px-4 py-2 text-center text-white hover:bg-blue-700'
        >
          Go to Join Queue
        </Link>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <p className='text-gray-500'>Loading your queue status...</p>
      </Shell>
    );
  }

  if (error || !status) {
    return (
      <Shell>
        <h1 className='mb-2 text-xl font-bold'>Status unavailable</h1>
        <p className='mb-6 text-gray-600'>{error ?? 'No status available.'}</p>
        <Link
          href='/visitor'
          className='block w-full rounded-md bg-blue-600 px-4 py-2 text-center text-white hover:bg-blue-700'
        >
          Back to QuietQueue
        </Link>
      </Shell>
    );
  }

  const banner = STATUS_BANNER[status.status];

  return (
    <Shell>
      <div className='mb-6 text-center'>
        <p className='text-sm text-gray-500'>Your ticket</p>
        <p className='text-4xl font-bold'>#{status.ticketNo}</p>
      </div>

      <div className={`mb-6 rounded-md border p-4 ${banner.wrapper}`}>
        <p className={`text-center text-lg font-semibold ${banner.label}`}>{banner.text}</p>
      </div>

      {status.status === 'waiting' && (
        <>
          <div className='mb-4 grid grid-cols-2 gap-4'>
            <Stat label='People ahead' value={String(Math.max(0, status.position - 1))} />
            <Stat label='Total waiting' value={String(status.totalWaiting)} />
          </div>

          <div className='mb-4 rounded-lg bg-white p-4 text-center shadow'>
            <p className='text-sm text-gray-600'>Estimated wait</p>
            <p className='text-2xl font-bold'>
              {status.minMinutes === status.maxMinutes
                ? `${status.minMinutes} min`
                : `${status.minMinutes}-${status.maxMinutes} min`}
            </p>
          </div>

          {status.alerted && (
            <div className='mb-4 rounded-md border border-amber-300 bg-amber-50 p-4'>
              <p className='text-center text-sm font-medium text-amber-900'>
                {alertMessage ?? 'Your turn is coming soon!'}
              </p>
            </div>
          )}
        </>
      )}

      {status.status === 'called' && (
        <p className='mb-4 rounded-md border border-orange-300 bg-orange-50 p-4 text-center text-sm text-orange-900'>
          Please proceed to the service desk now.
        </p>
      )}

      <p className='mt-4 text-center text-xs text-gray-500'>
        This page updates automatically every {POLL_INTERVAL_MS / 1000} seconds.
      </p>

      <Link
        href='/visitor'
        className='mt-4 block w-full rounded-md border border-gray-300 px-4 py-2 text-center text-gray-700 hover:bg-gray-50'
      >
        Back
      </Link>
    </Shell>
  );
}

const STATUS_BANNER: Record<QueueStatus['status'], { wrapper: string; label: string; text: string }> = {
  waiting: {
    wrapper: 'border-blue-200 bg-blue-50',
    label: 'text-blue-800',
    text: 'You are in the queue',
  },
  called: {
    wrapper: 'border-orange-300 bg-orange-50',
    label: 'text-orange-900',
    text: "You've been called!",
  },
  served: {
    wrapper: 'border-green-300 bg-green-50',
    label: 'text-green-800',
    text: 'Thank you, you have been served',
  },
  cancelled: {
    wrapper: 'border-gray-300 bg-gray-100',
    label: 'text-gray-700',
    text: 'This ticket was cancelled',
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex flex-1 items-center justify-center p-4'>
      <main className='w-full max-w-md'>{children}</main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-lg bg-white p-4 text-center shadow'>
      <p className='text-sm text-gray-600'>{label}</p>
      <p className='text-2xl font-bold'>{value}</p>
    </div>
  );
}