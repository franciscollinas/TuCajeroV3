import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { CashSessionService } from '../app/main/services/cash-session.service';
import { setupTestDatabase, cleanupTestDatabase, resetDatabaseState } from './integration-helper';
import { setDatabasePath, closeDatabase, getDatabase, schema } from '../app/main/db/index';

let nativeDbAvailable = true;
try {
  new Database(':memory:').close();
} catch {
  nativeDbAvailable = false;
}

// better-sqlite3 está compilado para el ABI de Electron; si se ejecuta vitest con
// el Node del sistema y el binario no coincide (NODE_MODULE_VERSION), se salta.
const serviceDescribe = nativeDbAvailable ? describe : describe.skip;

serviceDescribe('CashSession auto-close by inactivity', () => {
  let tempDbPath: string;
  let cashSessionService: CashSessionService;

  beforeAll(async () => {
    tempDbPath = await setupTestDatabase();
    setDatabasePath(tempDbPath);
    cashSessionService = new CashSessionService();
  });

  afterAll(async () => {
    closeDatabase();
    await cleanupTestDatabase(tempDbPath);
  });

  beforeEach(async () => {
    await resetDatabaseState();
  });

  afterEach(async () => {
    try {
      const active = await cashSessionService.getActiveCashSession(1);
      if (active) {
        await cashSessionService.closeCashSession(
          active.id,
          active.expectedCash ?? active.initialCash,
          active.expectedCash ?? active.initialCash,
          1,
          1,
        );
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it('closes an inactive session with closedAt set and no fabricated arqueo', async () => {
    const session = await cashSessionService.openCashSession(1, 1, 50000);

    const db = getDatabase();
    const stale = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    await db
      .update(schema.cashSessions)
      .set({ lastActivityAt: stale })
      .where(eq(schema.cashSessions.id, session.id));

    const closed = await cashSessionService.autoCloseInactiveSessions(3);
    expect(closed.map((entry) => entry.sessionId)).toContain(session.id);

    const [row] = await db.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
    expect(row.status).toBe('CLOSED');
    expect(row.closedAt).not.toBeNull();
    expect(row.finalCash).toBeNull();
    expect(row.difference).toBeNull();
  });

  it('keeps a recently active session open', async () => {
    const session = await cashSessionService.openCashSession(1, 1, 50000);

    const closed = await cashSessionService.autoCloseInactiveSessions(3);
    expect(closed.map((entry) => entry.sessionId)).not.toContain(session.id);

    const db = getDatabase();
    const [row] = await db.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
    expect(row.status).toBe('OPEN');
  });

  it('touchActivity records the current activity time', async () => {
    const session = await cashSessionService.openCashSession(1, 1, 50000);

    await cashSessionService.touchActivity(1);

    const db = getDatabase();
    const [row] = await db.select().from(schema.cashSessions).where(eq(schema.cashSessions.id, session.id));
    expect(row.lastActivityAt).not.toBeNull();
    expect(new Date(row.lastActivityAt!).getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
