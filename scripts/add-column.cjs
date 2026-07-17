const Database = require('better-sqlite3');
try {
  const db = new Database('./database/tucajero.db');
  db.exec('ALTER TABLE User ADD COLUMN branchId INTEGER REFERENCES Branch(id) ON DELETE SET NULL');
  console.log('Success: branchId column added.');
} catch (err) {
  if (err.message.includes('duplicate column name')) {
    console.log('Column already exists.');
  } else {
    console.error('Error:', err);
  }
}
