const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(process.cwd(), 'database/tucajero.db');

async function fixDB() {
  const sqlite = new Database(DB_PATH);
  
  try {
    sqlite.exec('BEGIN TRANSACTION');

    // Create Branch table if it doesn't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS Branch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accountId INTEGER NOT NULL REFERENCES Account(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_account_code ON Branch(accountId, code);
      CREATE INDEX IF NOT EXISTS idx_branch_account ON Branch(accountId);
    `);

    // Create BranchStock table if it doesn't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS BranchStock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branchId INTEGER NOT NULL REFERENCES Branch(id) ON DELETE CASCADE,
        productId INTEGER NOT NULL REFERENCES Product(id) ON DELETE CASCADE,
        stock REAL NOT NULL DEFAULT 0,
        minStock INTEGER NOT NULL DEFAULT 5,
        criticalStock INTEGER NOT NULL DEFAULT 2,
        location TEXT,
        expiryDate TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_branchstock_branch_product ON BranchStock(branchId, productId);
      CREATE INDEX IF NOT EXISTS idx_branchstock_branch ON BranchStock(branchId);
      CREATE INDEX IF NOT EXISTS idx_branchstock_product ON BranchStock(productId);
    `);

    // Helper to safely add a column
    function addColumnSafely(table, columnDef) {
      try {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
        console.log(`Added column to ${table}`);
      } catch (err) {
        if (!err.message.includes('duplicate column name')) {
          console.error(`Error adding column to ${table}:`, err.message);
        }
      }
    }

    addColumnSafely('CashSession', 'branchId INTEGER REFERENCES Branch(id)');
    addColumnSafely('StockMovement', 'branchId INTEGER REFERENCES Branch(id)');
    addColumnSafely('Sale', 'branchId INTEGER REFERENCES Branch(id)');
    addColumnSafely('Debt', 'branchId INTEGER REFERENCES Branch(id)');
    addColumnSafely('PurchaseOrder', 'branchId INTEGER REFERENCES Branch(id)');

    sqlite.exec('COMMIT');
    console.log('✅ Base de datos actualizada con las tablas y columnas de sucursales.');

  } catch (err) {
    sqlite.exec('ROLLBACK');
    console.error('❌ Error corrigiendo la DB:', err);
  } finally {
    sqlite.close();
  }
}

fixDB().catch(console.error);
