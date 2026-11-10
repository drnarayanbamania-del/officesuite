import clsx from 'clsx';
import {
  ChevronRight,
  FileSearch,
  FileText,
  Home,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Presentation,
  ScanText,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTheme } from '../lib/ui';
import { BrandLogo } from './BrandLogo';
import { SettingsModal } from './SettingsModal';
import { Toasts } from './Toasts';

type NavItem = { to: string; label: string; icon: LucideIcon; exact?: boolean };

const NAV_GROUPS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [{ to: '/', label: 'Home', icon: Home, exact: true }],
  },
  {
    id: 'create',
    label: 'Create',
    items: [
      { to: '/writer', label: 'Writer', icon: FileText },
      { to: '/sheet', label: 'Spreadsheets', icon: Table2 },
      { to: '/slides', label: 'Presentations', icon: Presentation },
    ],
  },
  {
    id: 'documents',
    label: 'Documents',
    items: [
      { to: '/pdf', label: 'PDF workspace', icon: FileSearch },
      { to: '/tools/recognize-scanned-copies', label: 'OCR scans', icon: ScanText },
    ],
  },
  {
    id: 'assist',
    label: 'Assist',
    items: [{ to: '/tools/ai-presentation', label: 'AI tools', icon: Sparkles }],
  },
];

const ALL_NAV = NAV_GROUPS.flatMap((group) => group.items);

function navItemClass(isActive: boolean, compact: boolean) {
  return clsx(
    'relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-all duration-150',
    isActive
      ? 'bg-brand-50/90 text-brand-700 shadow-[inset_0_1px_0_rgba(255,255,255,.6)] dark:bg-brand-400/10 dark:text-brand-200 dark:shadow-none'
      : 'text-ink-soft hover:bg-sunken/80 hover:text-ink',
    compact && 'justify-center px-0'
  );
}

function footerButtonClass(collapsed: boolean) {
  return clsx(
    'flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-[12.5px] font-medium text-ink-soft transition hover:bg-sunken hover:text-ink',
    collapsed && 'justify-center px-0'
  );
}

function LocalNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="mb-2 flex justify-center" title="Local and private">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line/80 bg-sunken/60 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        Local &amp; private
      </p>
      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">Your files stay in this browser. Nothing is uploaded.</p>
    </div>
  );
}

export default function Shell() {
  const { theme, toggle } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const activeNav = ALL_NAV.find((item) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to)
  );
  const section = activeNav?.label ?? (location.pathname.startsWith('/tools/') ? 'Tool workspace' : 'Office Suite');

  return (
    <div className="flex h-full text-ink">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'hidden shrink-0 flex-col border-r border-line bg-raised/85 backdrop-blur-xl transition-[width] duration-200 md:flex',
          collapsed ? 'w-20' : 'w-[252px]'
        )}
      >
        <div className={clsx('flex h-16 shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-5')}>
          {collapsed ? <BrandLogo variant="mark" /> : <BrandLogo />}
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group, groupIndex) => (
            <div
              key={group.id}
              className={clsx(
                groupIndex > 0 && (collapsed ? 'mt-3 border-t border-line pt-3' : 'mt-6')
              )}
            >
              {!collapsed ? (
                <p className="mb-1.5 px-3 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted/80">
                  {group.label}
                </p>
              ) : null}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.exact}
                    title={item.label}
                    className={({ isActive }) => navItemClass(isActive, collapsed)}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !collapsed ? (
                          <span className="absolute left-1.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-600 dark:bg-brand-400" />
                        ) : null}
                        <item.icon
                          className={clsx('shrink-0', collapsed ? 'h-[19px] w-[19px]' : 'h-[17px] w-[17px]')}
                          strokeWidth={1.9}
                        />
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          {collapsed ? <LocalNotice compact /> : <div className="mb-3"><LocalNotice /></div>}
          <div className="space-y-0.5">
            <button onClick={toggle} className={footerButtonClass(collapsed)} title="Toggle theme">
              {theme === 'dark' ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
              {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className={footerButtonClass(collapsed)}
              title="Settings"
            >
              <Settings className="h-[17px] w-[17px]" />
              {!collapsed && <span>Settings</span>}
            </button>
            <button
              onClick={() => setCollapsed((current) => !current)}
              className={footerButtonClass(collapsed)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative flex h-full w-[286px] flex-col border-r border-line bg-raised shadow-pop">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
              <BrandLogo />
              <button className="icon-btn" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              {NAV_GROUPS.map((group, groupIndex) => (
                <div key={group.id} className={groupIndex > 0 ? 'mt-6' : undefined}>
                  <p className="mb-1.5 px-3 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted/80">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.exact}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) => navItemClass(isActive, false)}
                      >
                        {({ isActive }) => (
                          <>
                            {isActive ? (
                              <span className="absolute left-1.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand-600 dark:bg-brand-400" />
                            ) : null}
                            <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t border-line p-3">
              <LocalNotice />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-raised/80 px-4 backdrop-blur-xl md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button className="icon-btn md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-[18px] w-[18px]" />
            </button>
            <div className="hidden min-w-0 items-center gap-2 text-[12.5px] md:flex">
              <span className="shrink-0 text-ink-muted">Office Suite</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted/60" />
              <span className="truncate font-semibold text-ink">{section}</span>
            </div>
            <BrandLogo className="md:hidden" />
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-line bg-sunken/50 px-3 py-1.5 text-[11px] font-medium text-ink-soft sm:flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              On-device
            </div>
            <div className="hidden h-5 w-px bg-line sm:block" />
            <button className="icon-btn" onClick={toggle} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toasts />
    </div>
  );
}
