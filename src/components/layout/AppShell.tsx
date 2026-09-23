import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  CalendarClock,
  LayoutDashboard,
  Receipt,
  Settings as SettingsIcon,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PeriodSwitcher } from './PeriodSwitcher';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'מרכז', icon: LayoutDashboard, end: true },
  { to: '/run', label: 'סגירת חודש', icon: CalendarClock },
  { to: '/transactions', label: 'תנועות', icon: Receipt },
];

function NavItem({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className="block">
      {({ isActive }) => (
        <span
          className={cn(
            'relative flex items-center gap-2.5 rounded-[var(--radius-field)] px-2.5 py-2',
            'text-[13px] font-medium transition-colors duration-150',
            isActive ? 'text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-2/60',
          )}
        >
          {isActive && (
            <motion.span
              layoutId="nav-active"
              transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              className="bg-surface-2 border-line absolute inset-0 rounded-[var(--radius-field)] border"
            />
          )}
          <Icon className="relative size-4 shrink-0" strokeWidth={1.75} />
          <span className="relative">{label}</span>
        </span>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();

  return (
    <div className="flex h-full">
      <nav className="border-line bg-surface flex w-56 shrink-0 flex-col border-e">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="bg-brand/12 text-brand flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-field)]">
            <Wallet className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">תקציב</div>
            <div className="text-fg-subtle text-[11px]">שלי · שלך · שלנו</div>
          </div>
        </div>

        <ul className="flex-1 space-y-0.5 px-2.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavItem {...item} />
            </li>
          ))}
        </ul>

        <div className="border-line mx-2.5 mb-2 flex items-center justify-between gap-2 border-t pt-2">
          <span className="text-fg-subtle ps-1 text-[11px]">ערכת נושא</span>
          <ThemeToggle />
        </div>

        <div className="px-2.5 pb-3">
          <NavItem to="/settings" label="הגדרות" icon={SettingsIcon} />
        </div>
      </nav>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-line bg-surface/80 flex h-14 shrink-0 items-center justify-center border-b px-7 backdrop-blur-sm">
          <PeriodSwitcher />
        </header>

        <main className="scroll-y flex-1">
          <div key={location.pathname} className="anim-rise mx-auto max-w-6xl px-7 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
