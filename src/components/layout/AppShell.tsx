import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarClock,
  Import,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Receipt,
  Settings as SettingsIcon,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/run', label: 'Monthly Run', icon: CalendarClock },
  { to: '/import', label: 'Import', icon: Import },
  { to: '/triage', label: 'Triage', icon: ListChecks },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/budget', label: 'Budget', icon: Wallet },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
];

export function AppShell() {
  return (
    <div className="flex h-full">
      <nav className="border-line bg-surface flex w-56 shrink-0 flex-col border-r">
        <div className="px-5 py-5">
          <div className="text-sm font-semibold tracking-tight">Budget</div>
          <div className="text-fg-subtle text-[11px]">Mine · Yours · Ours</div>
        </div>

        <ul className="flex-1 space-y-0.5 px-2.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                  )
                }
              >
                <item.icon className="size-4 shrink-0" strokeWidth={1.75} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="px-2.5 pb-3">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
              )
            }
          >
            <SettingsIcon className="size-4 shrink-0" strokeWidth={1.75} />
            Settings
          </NavLink>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-7 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
