import type { Metadata } from 'next';
import { pageTitle } from '@/lib/metadata';

export const metadata: Metadata = {
  title: pageTitle('Join the queue'),
  description:
    'Join a queue in seconds and get a live position, an estimated wait time, and an alert when your turn is close.',
};

// Layouts exist here only to carry route metadata, since the page below is a
// client component and cannot export metadata itself.
export default function VisitorLayout({ children }: LayoutProps<'/visitor'>) {
  return children;
}