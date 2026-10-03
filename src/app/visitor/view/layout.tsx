import type { Metadata } from 'next';
import { pageTitle } from '@/lib/metadata';

export const metadata: Metadata = {
  title: pageTitle('Your queue status'),
  description: 'Live queue position, estimated wait time, and turn alerts.',
  // Per-visitor, ID-gated view: useful to a person holding the link, but it
  // should never sit in a search index.
  robots: { index: false, follow: false },
};

// Layouts exist here only to carry route metadata, since the page below is a
// client component and cannot export metadata itself.
export default function VisitorViewLayout({ children }: LayoutProps<'/visitor/view'>) {
  return children;
}