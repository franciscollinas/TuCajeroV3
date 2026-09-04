import { type ReactNode, useState, useEffect, memo } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useConfig } from '../context/ConfigContext';
import { useLicense } from '../context/LicenseContext';
import { useRBAC } from '../hooks/useRBAC';
import { useNotifications } from '../hooks/useNotifications';
import { useCashAutoClose } from '../hooks/useCashAutoClose';
import type { Permission } from '../hooks/useRBAC';
import { es } from '../i18n';
import { AboutModal } from './AboutModal';
import { GrainOverlay } from './GrainOverlay';

interface LayoutProps { children: ReactNode; }

const P = {
  DASHBOARD: '/dashboard', ALERTS: '/alerts', INVENTORY: '/inventory', POS: '/sales',
  SALES_HISTORY: '/sales/history', CUSTOMERS: '/customers', CASH: '/cash',
  REPORTS: '/reports', USERS: '/users', AUDIT: '/audit', BACKUP: '/backup',
  LICENSE: '/license', PAYROLL: '/payroll', QUOTES: '/quotes', PRINTER: '/printer', SETTINGS: '/settings',
  INVENTORY_IMPORT: '/inventory/import', PURCHASE: '/purchase', BRANCHES: '/branches',
};

export function Layout({ children }: LayoutProps): JSX.Element {
  const { user, logout } = useAuth();
  const { config } = useConfig();
  const { isTrial, licenseInfo } = useLicense();
  const { can } = useRBAC();
  const location = useLocation();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(window.innerWidth <= 1024);

  useNotifications();
  useCashAutoClose();

  const handleLogout = async () => { await logout(); };

  const initials = user
    ? user.fullName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const navGroups = (() => {
    const groups = [
      { label: 'Principal', items: [
        { icon: dashboardIcon, label: es.dashboard.title, path: P.DASHBOARD },
        { icon: salesIcon, label: es.sales.posTitle, path: P.POS },
        { icon: historyIcon, label: es.sales.historyTitle, path: P.SALES_HISTORY },
        { icon: cashIcon, label: es.cashSession.status, path: P.CASH },
      ]},
      { label: 'Gestión', items: [
        { icon: quoteIcon, label: es.quote.title, path: P.QUOTES },
        { icon: usersIcon, label: 'Clientes', path: P.CUSTOMERS },
        { icon: inventoryIcon, label: es.inventory.title, path: P.INVENTORY },
        { icon: alertIcon, label: es.alerts.title, path: P.ALERTS },
        { icon: importIcon, label: es.inventory.importAction, path: P.INVENTORY_IMPORT, permission: 'inventory:all' },
        { icon: purchaseIcon, label: 'Proveedores', path: P.PURCHASE },
      ]},
      ...(can('audit:view') || can('users:all') || can('reports:all')
        ? [{ label: 'Administración', items: [
            { icon: reportsIcon, label: es.reports.title, path: P.REPORTS },
            { icon: auditIcon, label: es.audit.title, path: P.AUDIT, permission: 'audit:view' },
            { icon: usersIcon, label: es.users.title, path: P.USERS, permission: 'users:all' },
            { icon: purchaseIcon, label: 'Sucursales', path: P.BRANCHES, permission: 'users:all' },
            { icon: backupIcon, label: es.backup.title, path: P.BACKUP, permission: 'backup:all' },
            { icon: licenseIcon, label: es.license.title, path: P.LICENSE },
            { icon: payrollIcon, label: es.payroll.title, path: P.PAYROLL },
            { icon: printerIcon, label: es.settings.printer.title, path: P.PRINTER },
            { icon: settingsIcon, label: 'Configuración', path: P.SETTINGS },
          ].filter((i) => !i.permission || can(i.permission as Permission)) }]
        : []),
    ];
    return groups.filter((g) => g.items.length > 0);
  })();

  return (
    <div className={`tc-layout ${isCollapsed ? 'tc-layout--collapsed' : ''}`}>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <GrainOverlay />
      <a href="#main-content" className="skip-link">Saltar al contenido principal</a>
      <aside className="tc-sidebar" role="navigation" aria-label="Navegación principal">
        <div className="tc-sidebar-header" style={{ justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <img src="/isotipo.png" alt="TuCajero" style={{ width: 32, height: 32, flexShrink: 0 }} />
            {!isCollapsed && <span className="tc-logo-text"><span className="tc-logo-accent">Tu</span>Cajero</span>}
          </div>
        </div>
        <nav className="tc-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="tc-nav-group">
              {!isCollapsed && <div className="tc-nav-group-label">{group.label}</div>}
              {group.items.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link key={item.path} to={item.path} className={`tc-nav-item ${isActive ? 'tc-nav-item-active' : ''}`} title={isCollapsed ? item.label : ''} aria-current={isActive ? 'page' : undefined}>
                    <div className="tc-nav-icon">{item.icon}</div>
                    {!isCollapsed && <span className="tc-nav-item-text">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        {isTrial && !isCollapsed && (
          <div style={{ padding: '0 var(--space-4)', marginTop: 'var(--space-4)' }}>
            <div style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', color: '#059669' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
                {es.license.trialBadge}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>
                {licenseInfo?.trial.trialRemainingHours}{es.license.trialHours} {licenseInfo?.trial.trialRemainingMinutes}{es.license.trialMinutes} restantes
              </div>
            </div>
          </div>
        )}
        <div className="tc-sidebar-user">
          <div className="tc-user-avatar">{initials}</div>
          {!isCollapsed && (
            <div className="tc-user-info">
              <div className="tc-user-name">{user?.fullName ?? ''}</div>
              <div className="tc-user-role">{user?.role === 'ADMIN' ? 'Administrador' : user?.role === 'SUPERVISOR' ? 'Supervisor' : 'Cajero'}</div>
            </div>
          )}
          <div className={`tc-sidebar-user-actions ${isCollapsed ? 'tc-sidebar-user-actions--vertical' : ''}`}>
            <button type="button" onClick={() => setAboutOpen(true)} className="tc-btn--ghost" title="Acerca de">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </button>
            <button type="button" onClick={handleLogout} className="tc-btn--ghost" title={es.auth.logout}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </div>
        </div>
      </aside>
      <div className="tc-content">
        <header className="tc-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1, minWidth: 0 }}>
            <button type="button" className="tc-sidebar-toggle" onClick={() => setIsCollapsed(!isCollapsed)} title={isCollapsed ? 'Expandir Sidebar' : 'Colapsar Sidebar'}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: isCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-slow)' }}>
                <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: '0 0 auto' }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: config?.businessName ? 'var(--gradient-primary)' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 800, border: '2px solid var(--gray-100)' }}>
                {config?.businessName ? config.businessName.charAt(0).toUpperCase() : 'TC'}
              </div>
              <div style={{ minWidth: 0 }}>
                <h1 className="tc-header-title">{config?.businessName || 'TuCajero'}</h1>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--gray-400)', fontWeight: 500 }}>{pageTitle(location.pathname)}</p>
              </div>
            </div>
            <div style={{ width: 1, height: 32, background: 'var(--gray-200)', flexShrink: 0 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', minWidth: 0 }}>
              {config?.nit && <InfoItem icon="card" text={`NIT: ${config.nit}`} />}
              {config?.phone && <InfoItem icon="phone" text={config.phone} />}
              {config?.email && <InfoItem icon="mail" text={config.email} />}
              {config?.address && <InfoItem icon="map" text={config.address} />}
            </div>
          </div>
          <div style={{ flex: '0 0 auto', textAlign: 'right' }}><Clock /></div>
        </header>
        <main id="main-content" className="tc-main" role="main">{children}</main>
      </div>
    </div>
  );
}

/* ─── Helpers ─── */

function pageTitle(path: string): string {
  const map: Record<string, string> = {
    [P.DASHBOARD]: es.dashboard.title, [P.ALERTS]: es.alerts.title, [P.INVENTORY]: es.inventory.title,
    [P.POS]: es.sales.posTitle, [P.SALES_HISTORY]: es.sales.historyTitle, [P.CASH]: es.cashSession.status,
    [P.CUSTOMERS]: 'Clientes', [P.REPORTS]: es.reports.title, [P.USERS]: es.users.title,
    [P.AUDIT]: es.audit.title, [P.BACKUP]: es.backup.title, [P.LICENSE]: es.license.title,
    [P.PAYROLL]: es.payroll.title, [P.QUOTES]: es.quote.title,
    [P.PRINTER]: es.settings.printer.title, [P.SETTINGS]: 'Configuración',
    [P.INVENTORY_IMPORT]: es.inventory.bulkImport, [P.PURCHASE]: 'Proveedores',
    [P.BRANCHES]: 'Sucursales',
  };
  return map[path] ?? es.dashboard.title;
}

function InfoItem({ icon, text }: { icon: string; text: string }) {
  const icons: Record<string, ReactNode> = {
    card: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
    phone: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>,
    mail: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    map: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
      {icons[icon] ?? null}
      <span>{text}</span>
    </div>
  );
}

const Clock = memo(function Clock(): JSX.Element {
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); }, []);
  return (
    <>
      <span style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block' }}>
        {currentTime.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <span style={{ fontWeight: 700, color: 'var(--gray-700)', fontSize: 15 }}>
        {currentTime.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </>
  );
});

/* ─── SVG Icons ─── */

const dashboardIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>;
const salesIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>;
const historyIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const cashIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>;
const inventoryIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const alertIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const importIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const reportsIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const auditIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const usersIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>;
const backupIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const purchaseIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 16v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h2"/><rect x="8" y="3" width="8" height="18" rx="1"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></svg>;
const licenseIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const payrollIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
const quoteIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
const printerIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
const settingsIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;

