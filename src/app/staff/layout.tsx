import type { Metadata } from 'next';
import { pageTitle } from '@/lib/metadata';

export const metadata: Metadata = {
  title: pageTitle('Staff Dashboard'),
  description:
    'Call the next visitor, manage the live waiting list, and mark visitors as served or cancelled.',
  // No login exists yet, so this route must stay out of search results.
  robots: { index: false, follow: false },
};

// Layouts exist here only to carry route metadata, since the page below is a
// client component and cannot export metadata itself.
export default function StaffLayout({ children }: LayoutProps<'/staff'>) {
  return children;
}