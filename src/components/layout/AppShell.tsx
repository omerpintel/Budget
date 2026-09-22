import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarClock,
  LayoutDashboard,
  Receipt,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PeriodSwitcher } from './PeriodSwitcher';

const NAV = [
  { to: '/', label: 'מרכז', icon: LayoutDashboard, end: true },
  { to: '/run', label: 'סגירת חודש', icon: CalendarClock },
  { to: '/transactions', label: 'תנועות', icon: Receipt },
];

const LINK =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors';

function linkClass({ isActive }: { isActive: boolean }) {
  return cn(
    LINK,
    isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
  );
}

export function AppShell() {
  return (
    <div className="flex h-full">
      <nav className="border-line bg-surface flex w-56 shrink-0 flex-col border-e">
        <div className="px-5 py-5">
          <div className="text-sm font-semibold tracking-tight">תקציב</div>
          <div className="text-fg-subtle text-[11px]">שלי · שלך · שלנו</div>
        </div>

        <ul className="flex-1 space-y-0.5 px-2.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={linkClass}>
                <item.icon className="size-4 shrink-0" strokeWidth={1.75} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="px-2.5 pb-3">
          <NavLink to="/settings" className={linkClass}>
            <SettingsIcon className="size-4 shrink-0" strokeWidth={1.75} />
            הגדרות
          </NavLink>
        </div>
      </nav>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-line bg-surface flex h-14 shrink-0 items-center justify-center border-b px-7">
          <PeriodSwitcher />
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-7 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
