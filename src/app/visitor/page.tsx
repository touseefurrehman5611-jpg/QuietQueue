'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ToastProvider';

type Mode = 'join' | 'check';

export default function VisitorPage() {
  const [mode, setMode] = useState<Mode>('join');
  const [visitorId, setVisitorId] = useState('');

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex border-b">
        {(
          [
            { value: 'join', label: 'Join Queue' },
            { value: 'check', label: 'Check Status' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setMode(tab.value)}
            aria-current={mode === tab.value ? 'page' : undefined}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              mode === tab.value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === 'check' ? (
        <CheckPanel visitorId={visitorId} onVisitorIdChange={setVisitorId} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <JoinForm />
        </div>
      )}
    </div>
  );
}

function CheckPanel({
  visitorId,
  onVisitorIdChange,
}: {
  visitorId: string;
  onVisitorIdChange: (value: string) => void;
}) {
  const trimmed = visitorId.trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-xl font-bold">Check Your Status</h2>
        <p className="mb-4 text-sm text-gray-600">
          Paste the visitor ID you received when joining.
        </p>

        <label htmlFor="visitorId" className="mb-1 block text-sm font-medium text-gray-700">
          Visitor ID
        </label>
        <input
          id="visitorId"
          type="text"
          value={visitorId}
          onChange={(event) => onVisitorIdChange(event.target.value)}
          placeholder="e.g. 3f2b8c1a-4d5e-4f6a-8b9c-0d1e2f3a4b5c"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={trimmed && !isUuid ? 'visitorId-hint' : undefined}
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
        />

        {trimmed && !isUuid && (
          <p id="visitorId-hint" className="mt-2 text-xs text-amber-700">
            That does not look like a visitor ID.
          </p>
        )}

        {isUuid ? (
          <Link
            href={`/visitor/view?visitorId=${encodeURIComponent(trimmed)}`}
            className="mt-4 block w-full rounded-md bg-blue-600 px-4 py-2 text-center font-medium text-white transition hover:bg-blue-700"
          >
            Check Status
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="mt-4 w-full cursor-not-allowed rounded-md bg-gray-200 px-4 py-2 font-medium text-gray-500"
          >
            Check Status
          </button>
        )}
      </div>
    </div>
  );
}

function JoinForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [joinedAs, setJoinedAs] = useState<{ visitorId: string; ticketNo: number } | null>(null);
  const toast = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok || !data.visitorId) {
        toast.error(data.error ?? 'Could not join the queue. Please try again.');
        return;
      }

      setJoinedAs({ visitorId: data.visitorId, ticketNo: data.ticketNo });
      toast.success(`You are in the queue. Your ticket is #${data.ticketNo}.`);
    } catch {
      toast.error('Network problem. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (joinedAs) {
    return (
      <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-sm">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg
            className="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h2 className="text-xl font-bold text-green-700">Joined Successfully</h2>
        <p className="mt-1 text-gray-600">
          Ticket <span className="font-bold text-gray-900">#{joinedAs.ticketNo}</span>
        </p>

        <p className="mt-4 text-xs text-gray-500">Keep this ID to check your status later</p>
        <p className="mt-1 break-all rounded bg-gray-100 p-2 font-mono text-xs">
          {joinedAs.visitorId}
        </p>

        <Link
          href={`/visitor/view?visitorId=${encodeURIComponent(joinedAs.visitorId)}`}
          className="mt-4 block w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
        >
          View My Status
        </Link>
      </div>
    );
  }

  return (
    <main className="w-full max-w-md rounded-lg bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-center text-2xl font-bold">Join QuietQueue</h1>
      <p className="mb-6 text-center text-sm text-gray-600">
        It takes a few seconds and saves you the standing around.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={255}
            autoComplete="name"
            placeholder="Enter your name"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone <span className="font-normal text-gray-500">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={50}
            autoComplete="tel"
            placeholder="Enter your phone number"
            aria-describedby="phone-hint"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
          <p id="phone-hint" className="mt-1 text-xs text-gray-500">
            Only used to let you know your turn is close.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Joining...' : 'Join Queue'}
        </button>
      </form>
    </main>
  );
}