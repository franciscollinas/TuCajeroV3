import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const dir = join(tmpdir(), `tucajero-audit-daily-${Date.now()}`);
const dbPath = join(dir, 'test.db');

process.env.DATABASE_URL = dbPath;

const { AuditService } = await import('../app/main/services/audit.service');
const { ExportService } = await import('../app/main/services/export.service');
const { getDatabase, schema, closeDatabase } = await import('../app/main/db');
const { parseLocalDateOnly, toLocalIsoDate, addDays } = await import('../app/main/utils/date');

const auditService = new AuditService();
const exportService = new ExportService();

let nativeDbAvailable = true;
try {
  const probe = new Database(':memory:');
  probe.close();
} catch {
  nativeDbAvailable = false;
}

// better-sqlite3 está compilado para el ABI de Electron; si se ejecuta vitest con
// el Node del sistema y el binario no coincide (NODE_MODULE_VERSION), se salta.
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

const today = toLocalIsoDate(new Date());
const yesterday = toLocalIsoDate(addDays(new Date(), -1));
const day10 = '2026-01-10';

function createDatabase(): void {
  mkdirSync(dir, { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const migration = readFileSync(resolve('database/migrations/0000_melodic_barracuda.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.includes('--> statement-breakpoint'))
    .join('\n');
  sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO "Account" (name, nit, email, createdAt, updatedAt)
      VALUES ('Cuenta Test', '900000001', 'test@test.com', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('admin', 'hash', 'Admin', 'ADMIN', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO "User" (username, password, fullName, role, active, accountId, createdAt, updatedAt)
      VALUES ('cajero', 'hash', 'Cajero', 'CASHIER', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  sqlite.close();
}

// Inserta un evento de auditoría en un día local dado (12:00 local → ISO UTC).
function insertEvent(userId: number, action: string, entity: string, localDay: string): void {
  const at = new Date(parseLocalDateOnly(localDay).getTime() + 12 * 60 * 60 * 1000);
  getDatabase()
    .insert(schema.auditLogs)
    .values({ accountId: 1, userId, action, entity, payload: '{"origen":"test"}', createdAt: at.toISOString() })
    .run();
}

const generatedFiles: string[] = [];

serviceDescribe('AuditService — Log diario de auditoría', () => {
  beforeAll(() => {
    createDatabase();
  });

  afterAll(() => {
    for (const file of generatedFiles) {
      try { rmSync(file, { force: true }); } catch { /* ignorar */ }
    }
    closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  });

  it('computeDailySummary agrupa acciones por usuario dentro del día local', async () => {
    insertEvent(1, 'sale:created', 'Sale', day10);
    insertEvent(1, 'sale:created', 'Sale', day10);
    insertEvent(1, 'inventory:updated', 'Product', day10);
    insertEvent(2, 'sale:cancelled', 'Sale', day10);
    insertEvent(1, 'out:of:day', 'Otra', '2026-01-11');

    const summary = await auditService.computeDailySummary(day10, 1);
    expect(summary.totalEvents).toBe(4);
    const admin = summary.byUser.find((u) => u.userId === 1);
    expect(admin?.total).toBe(3);
    expect(admin?.actions['sale:created']).toBe(2);
    expect(admin?.actions['inventory:updated']).toBe(1);
    expect(admin?.userName).toBe('Admin');
    const cashier = summary.byUser.find((u) => u.userId === 2);
    expect(cashier?.actions['sale:cancelled']).toBe(1);
  });

  it('getOrCreateDailyLog persiste el resumen y no duplica (idempotente)', async () => {
    const first = await auditService.getOrCreateDailyLog(day10, 1);
    expect(first.created).toBe(true);
    expect(first.log.summary.totalEvents).toBe(4);

    const second = await auditService.getOrCreateDailyLog(day10, 1);
    expect(second.created).toBe(false);
    expect(second.log.id).toBe(first.log.id);
    expect(second.log.summary.totalEvents).toBe(4);
  });

  it('saveTodayLog crea/actualiza el log de HOY en la misma fila', async () => {
    const before = await auditService.saveTodayLog(1);
    insertEvent(1, 'config:updated', 'Config', today);
    const after = await auditService.saveTodayLog(1);
    expect(after.id).toBe(before.id);
    expect(after.summary.totalEvents).toBe(before.summary.totalEvents + 1);
  });

  it('ensureDailyLogs genera días pasados con actividad y omite vacíos', async () => {
    insertEvent(2, 'user:created', 'User', yesterday);

    const generated = await auditService.ensureDailyLogs(1, 2);
    expect(generated).toBeGreaterThanOrEqual(1);

    const yesterdayLog = await auditService.findDailyLog(yesterday, 1);
    expect(yesterdayLog).not.toBeNull();
    expect(yesterdayLog?.summary.totalEvents).toBe(1);

    const todayLog = await auditService.findDailyLog(today, 1);
    expect(todayLog?.summary.totalEvents).toBeGreaterThanOrEqual(1);

    const future = toLocalIsoDate(addDays(new Date(), 2));
    expect(await auditService.findDailyLog(future, 1)).toBeNull();
  });

  it('getDailyLogs filtra por rango de fechas y ordena descendente', async () => {
    const logs = await auditService.getDailyLogs({ accountId: 1, startDate: day10, endDate: day10 });
    expect(logs.length).toBe(1);
    expect(logs[0].date).toBe(day10);

    const empty = await auditService.getDailyLogs({ accountId: 1, startDate: '2030-01-01', endDate: '2030-01-02' });
    expect(empty.length).toBe(0);
  });

  it('getOrCreateDailyLog no crea filas para días sin actividad (skip si total 0)', async () => {
    const emptyDay = '2026-05-05';
    const result = await auditService.getOrCreateDailyLog(emptyDay, 1);
    expect(result.created).toBe(false);
    expect(result.log.summary.totalEvents).toBe(0);
  });

  it('exportDailyAudit genera CSV y XLSX con el combo día/usuario/acción', async () => {
    const csv = await exportService.exportDailyAudit(day10, day10, 'csv', 1);
    expect(existsSync(csv)).toBe(true);
    expect(csv.endsWith('.csv')).toBe(true);
    generatedFiles.push(csv);

    const xlsx = await exportService.exportDailyAudit(day10, day10, 'xlsx', 1);
    expect(existsSync(xlsx)).toBe(true);
    expect(xlsx.endsWith('.xlsx')).toBe(true);
    generatedFiles.push(xlsx);
  });

  it('ensureDailyLogsForAllAccounts recorre todas las cuentas sin lanzar', async () => {
    const total = await auditService.ensureDailyLogsForAllAccounts(1);
    expect(total).toBeGreaterThanOrEqual(0);
  });
});