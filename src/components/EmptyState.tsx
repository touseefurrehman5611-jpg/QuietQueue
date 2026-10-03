interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: 'queue' | 'called' | 'search';
}

const ICONS: Record<NonNullable<EmptyStateProps['icon']>, string> = {
  queue: 'M4 6h16M4 12h16M4 18h10',
  called: 'M5 13l4 4L19 7',
  search: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
};

export function EmptyState({ title, description, action, icon = 'queue' }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
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
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <p className="text-base font-semibold text-gray-800">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-gray-600">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}