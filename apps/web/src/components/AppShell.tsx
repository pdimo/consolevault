import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import { Button, cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ to: '/overview', label: 'Overview', icon: '▤' }] },
  {
    group: 'Analytics',
    items: [
      { to: '/dashboards', label: 'Dashboards', icon: '◫' },
      { to: '/opportunities', label: 'Opportunities', icon: '◎' },
    ],
  },
  {
    group: 'Data',
    items: [
      { to: '/properties', label: 'Properties', icon: '▦' },
      { to: '/groups', label: 'Groups', icon: '❏' },
    ],
  },
  { group: 'Connections', items: [{ to: '/accounts', label: 'Accounts', icon: '⚿' }] },
  {
    group: 'Operations',
    items: [
      { to: '/jobs', label: 'Jobs', icon: '↻' },
      { to: '/health', label: 'Health', icon: '✚' },
    ],
  },
  {
    group: 'Usage',
    items: [
      { to: '/costs', label: 'Costs', icon: '$' },
      { to: '/quota', label: 'Quota', icon: '◔' },
    ],
  },
  { items: [{ to: '/settings', label: 'Settings', icon: '⚙' }] },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV.map((section, i) => (
        <div key={i} className="flex flex-col gap-1">
          {section.group && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {section.group}
            </p>
          )}
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent/12 text-accent'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <span className="w-4 text-center opacity-80">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-4 py-4">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-fg">
        CV
      </span>
      <span className="font-semibold">ConsoleVault</span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [drawer, setDrawer] = useState(false);
  const email = state.status === 'authed' ? state.email : '';

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface md:flex">
        <Brand />
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute inset-y-0 left-0 flex w-60 flex-col border-r border-line bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <Brand />
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="md:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur">
          <button
            className="rounded-lg p-2 text-muted hover:bg-surface-2 md:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="flex-1" />
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-muted hover:bg-surface-2"
            aria-label="Toggle theme"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {email && <span className="hidden text-sm text-muted sm:inline">{email}</span>}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
