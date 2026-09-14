import { lazy, Suspense, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import { initDb } from '@/db';
import { getSetting, SETTING_KEYS } from '@/data/settings';
import { autoSnapshot } from '@/data/snapshots';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DashboardPage } from '@/pages/DashboardPage';

// Everything except the dashboard loads on demand; the SQLite worker is already
// a large download and there is no reason to ship every screen up front.
const MonthlyRunPage = lazy(() =>
  import('@/features/run/MonthlyRunPage').then((m) => ({ default: m.MonthlyRunPage })),
);
const ImportPage = lazy(() =>
  import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const TriagePage = lazy(() =>
  import('@/features/triage/TriagePage').then((m) => ({ default: m.TriagePage })),
);
const TransactionsPage = lazy(() =>
  import('@/pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const BudgetPage = lazy(() =>
  import('@/features/budget/BudgetPage').then((m) => ({ default: m.BudgetPage })),
);
const InsightsPage = lazy(() =>
  import('@/features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const OnboardingPage = lazy(() =>
  import('@/features/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

function Loading() {
  return <div className="text-fg-subtle flex h-full items-center justify-center text-sm">Loading…</div>;
}

function page(element: React.ReactNode) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>{element}</Suspense>
    </ErrorBoundary>
  );
}

const router = createHashRouter([
  { path: '/onboarding', element: page(<OnboardingPage />) },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'run', element: page(<MonthlyRunPage />) },
      { path: 'import', element: page(<ImportPage />) },
      { path: 'triage', element: page(<TriagePage />) },
      { path: 'transactions', element: page(<TransactionsPage />) },
      { path: 'budget', element: page(<BudgetPage />) },
      { path: 'insights', element: page(<InsightsPage />) },
      { path: 'settings', element: page(<SettingsPage />) },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

type BootState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(async () => {
        const done = await getSetting(SETTING_KEYS.onboardingComplete);
        if (cancelled) return;
        if (done !== '1' && !window.location.hash.startsWith('#/onboarding')) {
          window.location.hash = '#/onboarding';
        }
        setBoot({ status: 'ready' });
        void autoSnapshot();
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoot({ status: 'error', message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.status === 'loading') {
    return (
      <div className="text-fg-subtle flex h-full items-center justify-center text-sm">
        Opening your ledger…
      </div>
    );
  }

  if (boot.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-negative text-sm font-semibold">Could not open the database</h1>
          <p className="text-fg-muted text-xs break-words">{boot.message}</p>
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
