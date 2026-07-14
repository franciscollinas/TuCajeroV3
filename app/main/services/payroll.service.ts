import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db';

type PayrollPeriod = 'daily' | 'weekly' | 'monthly';

interface PayrollDayEntry {
  date: string;
  dayName: string;
  loginCount: number;
  workedSeconds: number;
  workedHours: number;
  hourlyRate: number;
  payAmount: number;
  dailySalesTotal: number;
}

interface PayrollUserSummary {
  userId: number;
  fullName: string;
  username: string;
  hourlyRate: number;
  period: PayrollPeriod;
  periodStart: string;
  periodEnd: string;
  days: PayrollDayEntry[];
  totalDays: number;
  totalWorkedSeconds: number;
  totalWorkedHours: number;
  totalPayAmount: number;
  totalSalesAmount: number;
}

interface PayrollAllUsersResult {
  users: PayrollUserSummary[];
  grandTotalPay: number;
  grandTotalHours: number;
  grandTotalSales: number;
  generatedAt: string;
}

export class PayrollService {
  async getPayroll(period: PayrollPeriod, periodStart: string, periodEnd: string, accountId?: number | null): Promise<PayrollAllUsersResult> {
    const db = getDatabase();
    const startDate = new Date(periodStart);
    const endDate = new Date(periodEnd);
    endDate.setHours(23, 59, 59, 999);

    const usersList = await db
      .select()
      .from(schema.users)
      .where(and(
        eq(schema.users.active, true),
        sql`${schema.users.hourlyRate} IS NOT NULL`,
        accountId ? eq(schema.users.accountId, accountId) : undefined,
      ));

    const users: PayrollUserSummary[] = [];

    for (const user of usersList) {
      const days = await this.getPayrollDays(user.id, startDate, endDate);
      const totalWorkedSeconds = days.reduce((sum, d) => sum + d.workedSeconds, 0);
      const totalWorkedHours = days.reduce((sum, d) => sum + d.workedHours, 0);
      const totalPayAmount = days.reduce((sum, d) => sum + d.payAmount, 0);
      const totalSalesAmount = days.reduce((sum, d) => sum + d.dailySalesTotal, 0);

      users.push({
        userId: user.id,
        fullName: user.fullName,
        username: user.username,
        hourlyRate: user.hourlyRate ?? 0,
        period,
        periodStart: startDate.toISOString(),
        periodEnd: endDate.toISOString(),
        days,
        totalDays: days.length,
        totalWorkedSeconds,
        totalWorkedHours,
        totalPayAmount,
        totalSalesAmount,
      });
    }

    return {
      users,
      grandTotalPay: users.reduce((sum, u) => sum + u.totalPayAmount, 0),
      grandTotalHours: users.reduce((sum, u) => sum + u.totalWorkedHours, 0),
      grandTotalSales: users.reduce((sum, u) => sum + u.totalSalesAmount, 0),
      generatedAt: new Date().toISOString(),
    };
  }

  private async getPayrollDays(userId: number, startDate: Date, endDate: Date): Promise<PayrollDayEntry[]> {
    const db = getDatabase();

    const [user] = await db
      .select({ hourlyRate: schema.users.hourlyRate })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const hourlyRate = user?.hourlyRate ?? 0;

    const sessions = await db
      .select({
        createdAt: schema.sessions.createdAt,
        closedAt: schema.sessions.closedAt,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, userId),
          gte(schema.sessions.createdAt, startDate.toISOString()),
          lte(schema.sessions.createdAt, endDate.toISOString()),
        ),
      );

    const dayMap = new Map<string, { seconds: number; sessions: number }>();

    for (const s of sessions) {
      const start = new Date(s.createdAt).getTime();
      const end = s.closedAt
        ? new Date(s.closedAt).getTime()
        : new Date(s.expiresAt).getTime();
      const seconds = Math.max(0, (end - start) / 1000);

      const dayKey = s.createdAt.slice(0, 10);
      const entry = dayMap.get(dayKey) ?? { seconds: 0, sessions: 0 };
      entry.seconds += seconds;
      entry.sessions += 1;
      dayMap.set(dayKey, entry);
    }

    const days: PayrollDayEntry[] = [];
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    for (const [dateKey, data] of dayMap) {
      const dateObj = new Date(dateKey + 'T00:00:00');
      const dayName = dayNames[dateObj.getDay()];
      const workedSeconds = Math.round(data.seconds);
      const workedHours = Math.round((data.seconds / 3600) * 100) / 100;
      const payAmount = Math.round(workedHours * hourlyRate * 100) / 100;

      const dailySalesResult = await db
        .select({ total: sql`COALESCE(SUM(${schema.sales.total}), 0)` })
        .from(schema.sales)
        .where(
          and(
            eq(schema.sales.userId, userId),
            eq(schema.sales.status, 'COMPLETED'),
            gte(schema.sales.createdAt, dateKey + 'T00:00:00'),
            lte(schema.sales.createdAt, dateKey + 'T23:59:59'),
          ),
        );

      const dailySalesTotal = Number(dailySalesResult[0]?.total ?? 0);

      days.push({
        date: dateKey,
        dayName,
        loginCount: data.sessions,
        workedSeconds,
        workedHours,
        hourlyRate,
        payAmount,
        dailySalesTotal,
      });
    }

    days.sort((a, b) => a.date.localeCompare(b.date));
    return days;
  }
}
