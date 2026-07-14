import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useCallback } from 'react';
import { DollarSign, Clock, User, TrendingUp, Calendar, Download } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { formatCurrency } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { PayrollAllUsersResult, PayrollPeriod } from '../../shared/types/user.types';

export default function PayrollPage(): JSX.Element {
  const [period, setPeriod] = useState<PayrollPeriod>('weekly');
  const [result, setResult] = useState<PayrollAllUsersResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const getPeriodRange = useCallback((p: PayrollPeriod): { start: string; end: string } => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);

    if (p === 'daily') {
      return { start: end, end };
    }

    if (p === 'weekly') {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      return { start: start.toISOString().slice(0, 10), end };
    }

    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.toISOString().slice(0, 10), end };
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const range = getPeriodRange(period);
      const data = await trpc.payroll.getPayroll.query({
        period,
        periodStart: range.start,
        periodEnd: range.end,
      });
      setResult(data as PayrollAllUsersResult);
    } catch (err) {
      rendererLogger.error('PayrollPage', 'Payroll error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPayroll = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const range = getPeriodRange(period);
      const res = await trpc.export.payroll.mutate({
        userId: 0,
        periodStart: range.start,
        periodEnd: range.end,
      });
      const { path } = res as { path: string };
      if (path && window.api?.openFile) {
        await window.api.openFile(path);
      }
    } catch (err) {
      rendererLogger.error('PayrollPage', 'Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="tc-page">
      <div className="tc-page-header">
        <div>
          <span className="tc-badge tc-badge--brand tc-badge--sm" style={{ marginBottom: 'var(--space-2)' }}>
            <DollarSign size={14} />
            <span>{es.payroll.title}</span>
          </span>
          <h1 className="tc-page-title">{es.payroll.title}</h1>
          <p className="tc-page-subtitle">{es.payroll.subtitle}</p>
        </div>
      </div>

      {/* Period filter */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div className="tc-field" style={{ flex: '0 0 200px' }}>
            <label className="tc-label">
              <Calendar size={14} />
              {es.payroll.period}
            </label>
            <select
              className="tc-input"
              value={period}
              onChange={(e) => setPeriod(e.target.value as PayrollPeriod)}
            >
              <option value="daily">{es.payroll.daily}</option>
              <option value="weekly">{es.payroll.weekly}</option>
              <option value="monthly">{es.payroll.monthly}</option>
            </select>
          </div>
          <LoadingButton
            onClick={handleGenerate}
            loading={loading}
            className="tc-btn tc-btn--primary"
            style={{ height: 44 }}
          >
            <TrendingUp size={16} />
            {es.payroll.generate}
          </LoadingButton>
          {result && (
            <LoadingButton
              onClick={handleExportPayroll}
              loading={exporting}
              className="tc-btn tc-btn--secondary"
              style={{ height: 44 }}
            >
              <Download size={16} />
              {es.export.exportPayroll}
            </LoadingButton>
          )}
        </div>
      </Card>

      {/* Results */}
      {loading && <LoadingSpinner />}

      {result && !loading && (
        <>
          {/* Grand totals */}
          <div className="tc-grid-4" style={{ marginTop: 'var(--space-6)' }}>
            <div className="tc-metric">
              <div className="tc-metric-icon" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}>
                <DollarSign size={24} />
              </div>
              <div>
                <div className="tc-metric-value">{formatCurrency(result.grandTotalPay)}</div>
                <div className="tc-metric-label">{es.payroll.grandTotalPay}</div>
              </div>
            </div>
            <div className="tc-metric">
              <div className="tc-metric-icon" style={{ background: 'var(--green-50)', color: 'var(--green-600)' }}>
                <Clock size={24} />
              </div>
              <div>
                <div className="tc-metric-value">{result.grandTotalHours.toFixed(1)}h</div>
                <div className="tc-metric-label">{es.payroll.grandTotalHours}</div>
              </div>
            </div>
            <div className="tc-metric">
              <div className="tc-metric-icon" style={{ background: 'var(--purple-50)', color: 'var(--purple-600)' }}>
                <TrendingUp size={24} />
              </div>
              <div>
                <div className="tc-metric-value">{formatCurrency(result.grandTotalSales)}</div>
                <div className="tc-metric-label">{es.payroll.grandTotalSales}</div>
              </div>
            </div>
            <div className="tc-metric">
              <div className="tc-metric-icon" style={{ background: 'var(--orange-50)', color: 'var(--orange-600)' }}>
                <User size={24} />
              </div>
              <div>
                <div className="tc-metric-value">{result.users.length}</div>
                <div className="tc-metric-label">{es.payroll.employee}s</div>
              </div>
            </div>
          </div>

          {result.users.length === 0 ? (
            <Card>
              <EmptyState icon={DollarSign} title={es.payroll.noData} />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
              {result.users.map((user) => (
                <Card key={user.userId}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => setExpandedUser(expandedUser === user.userId ? null : user.userId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 'var(--radius-lg)',
                        background: 'var(--brand-50)', color: 'var(--brand-600)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 14,
                      }}>
                        {user.fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{user.fullName}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>
                          {es.payroll.hourlyRate}: {formatCurrency(user.hourlyRate)}/h
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.payroll.hoursWorked}</div>
                        <div style={{ fontWeight: 700, color: 'var(--gray-900)' }}>{user.totalWorkedHours.toFixed(1)}h</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.payroll.totalSales}</div>
                        <div style={{ fontWeight: 700, color: 'var(--gray-700)' }}>{formatCurrency(user.totalSalesAmount)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.payroll.totalPay}</div>
                        <div style={{ fontWeight: 800, color: 'var(--brand-600)', fontSize: 'var(--text-lg)' }}>{formatCurrency(user.totalPayAmount)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded day detail */}
                  {expandedUser === user.userId && (
                    <div style={{ marginTop: 'var(--space-4)', borderTop: '1px solid var(--border-light)', paddingTop: 'var(--space-4)' }}>
                      <div className="tc-table-wrap" style={{ borderRadius: 'var(--radius-2xl)' }}>
                        <table className="tc-table">
                          <thead>
                            <tr>
                              <th>{es.payroll.date}</th>
                              <th>{es.payroll.day}</th>
                              <th>{es.payroll.logins}</th>
                              <th>{es.payroll.hoursWorked}</th>
                              <th>{es.payroll.sales}</th>
                              <th>{es.payroll.pay}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {user.days.map((day) => (
                              <tr key={day.date}>
                                <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                                  {new Date(day.date + 'T00:00:00').toLocaleDateString('es-CO')}
                                </td>
                                <td>{day.dayName}</td>
                                <td>{day.loginCount}</td>
                                <td>{day.workedHours.toFixed(2)}h</td>
                                <td>{formatCurrency(day.dailySalesTotal)}</td>
                                <td style={{ fontWeight: 700, color: 'var(--brand-600)' }}>{formatCurrency(day.payAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!result && !loading && (
        <Card>
          <EmptyState icon={DollarSign} title={es.payroll.noData} />
        </Card>
      )}
    </div>
  );
}
