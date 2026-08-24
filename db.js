const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'bids.db'));

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

function cleanupPending() {
    db.prepare(`DELETE FROM bids WHERE status = 'pending' AND created_at < datetime('now', '-30 minutes')`).run();
}

// Seed demo data if table is empty
const isEmpty = db.prepare('SELECT COUNT(*) as cnt FROM bids').get().cnt === 0;
if (isEmpty) {
    const samples = [
        { username: 'instagram',     bid: 95000, offset: '-8 days'  },
        { username: 'nike',          bid: 82000, offset: '-7 days'  },
        { username: 'nasa',          bid: 61000, offset: '-5 days'  },
        { username: 'natgeo',        bid: 45000, offset: '-4 days'  },
        { username: 'redbull',       bid: 32000, offset: '-3 days'  },
        { username: 'gopro',         bid: 21000, offset: '-2 days'  },
        { username: 'bmw',           bid: 15000, offset: '-1 days'  },
        { username: 'mercedes_benz', bid:  9000, offset: '-12 hours' },
        { username: 'levis',         bid:  5500, offset: '-6 hours'  },
        { username: 'spotify',       bid:  2200, offset: '-1 hours'  },
    ];
    const ins = db.prepare(`INSERT INTO bids (username,image_url,profile_url,bid_amount,status,created_at) VALUES (?,?,?,?,'paid',datetime('now',?))`);
    for (const s of samples) {
        ins.run(s.username, `https://unavatar.io/instagram/${s.username}`, `https://instagram.com/${s.username}`, s.bid, s.offset);
    }
}

module.exports = { db, cleanupPending };
