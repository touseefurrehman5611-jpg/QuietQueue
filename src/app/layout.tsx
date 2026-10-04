import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';
import { ToastProvider } from '@/components/ToastProvider';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Needed for absolute OG/canonical URLs. Falls back to localhost so the build
// never fails when the deployment URL is not configured yet.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'QuietQueue - Skip the line, not your day',
    // Fallback only. Every route in this app sets an `absolute` title via
    // pageTitle(), because the template was seen applying inconsistently
    // across route depths.
    template: '%s | QuietQueue',
  },
  description:
    'QuietQueue is a digital queue system that lets visitors track their position, get live wait estimates, and be notified the moment their turn arrives.',
  applicationName: 'QuietQueue',
  keywords: ['queue', 'virtual queue', 'queue management', 'wait time', 'smart queue'],
  openGraph: {
    type: 'website',
    siteName: 'QuietQueue',
    title: 'QuietQueue - Skip the line, not your day',
    description:
      'Join a queue from your phone, watch your position update live, and get alerted when it is nearly your turn.',
    url: siteUrl,
  },
  twitter: {
    card: 'summary',
    title: 'QuietQueue - Skip the line, not your day',
    description:
      'Join a queue from your phone, watch your position update live, and get alerted when it is nearly your turn.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  // Not pinning a maximum lets small phones keep page zoom, which matters
  // because every queue interaction is a tap target.
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <ToastProvider>
          <SiteHeader />
          <main id="main" className="flex flex-1 flex-col">
            {children}
          </main>
          <footer className="border-t border-gray-200 px-4 py-4 text-center text-xs text-gray-500">
            QuietQueue &middot; a calmer way to wait
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}