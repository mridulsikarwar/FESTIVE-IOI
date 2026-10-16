const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'festive.db');
const db = new sqlite3.Database(DB_PATH);

// Helper to run queries with promises
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

async function initDb() {
  db.serialize(async () => {
    // 1. Departments table
    db.run(`
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE
      )
    `);

    // 2. Students & Registrations table
    db.run(`
      CREATE TABLE IF NOT EXISTS students (
        enrollment_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        year INTEGER NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        google_id TEXT,
        ticket_token TEXT NOT NULL UNIQUE,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Attendance Logs table (Guarantees one check-in per ticket, logs timestamp and scanner)
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        attendance_id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'Present',
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        scanned_by TEXT DEFAULT 'Admin Scanner',
        FOREIGN KEY (enrollment_id) REFERENCES students(enrollment_id)
      )
    `);

    // Seed default departments if empty
    db.get(`SELECT COUNT(*) as count FROM departments`, (err, row) => {
      if (!err && row && row.count === 0) {
        const stmt = db.prepare(`INSERT INTO departments (name, code) VALUES (?, ?)`);
        const depts = [
          ['Computer Science and Engineering', 'CSE'],
          ['Information Technology', 'IT'],
          ['Electronics and Communication', 'ECE'],
          ['Electrical Engineering', 'EE'],
          ['Mechanical Engineering', 'ME'],
          ['Civil Engineering', 'CE'],
          ['Biotechnology', 'BT'],
          ['Management / MBA', 'MGMT']
        ];
        depts.forEach(d => stmt.run(d[0], d[1]));
        stmt.finalize();
      }
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb
};
