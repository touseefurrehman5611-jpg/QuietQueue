import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/metadata';

export const metadata: Metadata = {
  title: pageTitle('Skip the line, not your day'),
  description:
    'Join a queue from your phone and watch your position update live. No standing around, no wondering how long is left.',
};

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <main className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">QuietQueue</h1>
          <p className="mt-2 text-gray-600">
            Take your place in line from anywhere, and watch your turn approach live.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/visitor"
            className="block w-full rounded-lg bg-blue-600 px-6 py-4 text-center text-lg font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Join as Visitor
          </Link>
          <Link
            href="/staff"
            className="block w-full rounded-lg bg-green-600 px-6 py-4 text-center text-lg font-semibold text-white shadow-sm transition hover:bg-green-700"
          >
            Staff Dashboard
          </Link>
        </div>

        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-green-600" aria-hidden="true">
              &#10003;
            </span>
            Live position and wait estimate, updated automatically
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-green-600" aria-hidden="true">
              &#10003;
            </span>
            Alert the moment your turn is close
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-green-600" aria-hidden="true">
              &#10003;
            </span>
            No account needed
          </li>
        </ul>
      </main>
    </div>
  );
}