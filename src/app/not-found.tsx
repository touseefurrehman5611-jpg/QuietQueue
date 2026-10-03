import type { Metadata } from 'next';
import Link from 'next/link';
import { pageTitle } from '@/lib/metadata';

export const metadata: Metadata = {
  title: pageTitle('Page not found'),
  description: 'The page you were looking for does not exist or has moved.',
};

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <main className="w-full max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Error 404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h1>
        <p className="mt-3 text-gray-600">
          The page you were looking for does not exist, or it may have moved.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="rounded-md bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            Back to home
          </Link>
          <Link
            href="/visitor"
            className="rounded-md border border-gray-300 px-5 py-3 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Join a queue
          </Link>
        </div>
      </main>
    </div>
  );
}