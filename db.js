const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'bids.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);

db.exec(`
  CREATE TABLE IF NOT EXISTS bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    image_url TEXT NOT NULL,
    profile_url TEXT NOT NULL,
    bid_amount INTEGER NOT NULL,
    stripe_session_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
  )
`);
db.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES ('visitors', 0)`).run();

const demoDataCleanup = db.prepare(`SELECT value FROM stats WHERE key = 'demo_data_removed'`).get();
if (!demoDataCleanup) {
  db.prepare(`DELETE FROM bids WHERE (username, bid_amount) IN (
    ('instagram', 95000), ('nike', 82000), ('nasa', 61000), ('natgeo', 45000),
    ('redbull', 32000), ('gopro', 21000), ('bmw', 15000),
    ('mercedes_benz', 9000), ('levis', 5500), ('spotify', 2200)
  )`).run();
  db.prepare(`INSERT INTO stats (key, value) VALUES ('demo_data_removed', 1)`).run();
}

function cleanupPending() {
    db.prepare(`DELETE FROM bids WHERE status = 'pending' AND created_at < datetime('now', '-30 minutes')`).run();
}

module.exports = { db, cleanupPending };
