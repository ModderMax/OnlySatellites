const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'localData.db');

// Make sure the data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir); // Make sure the file exists
}

// Open the DB
const db = new Database(dbPath);

// Ensure the table exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL
  )
`).run();

// === EXPORTED FUNCTIONS ===

function addNote(timestamp, title, description) {
  const stmt = db.prepare(`
    INSERT INTO notes (timestamp, title, description)
    VALUES (?, ?, ?)
  `);
  const info = stmt.run(timestamp, title, description);
  return info.lastInsertRowid; // Return the new ID
}

function deleteNoteById(id) {
  const stmt = db.prepare(`DELETE FROM notes WHERE id = ?`);
  const info = stmt.run(id);
  return info.changes > 0; // true if a row was deleted
}

function deleteNoteByTimestamp(timestamp) {
  const stmt = db.prepare(`DELETE FROM notes WHERE timestamp = ?`);
  const info = stmt.run(timestamp);
  return info.changes > 0;
}

function getAllNotes() {
  const stmt = db.prepare(`SELECT * FROM notes ORDER BY timestamp DESC`);
  return stmt.all();
}

// === Optional: Run directly to test setup ===
if (require.main === module) {
  console.log('Database ready. Example insert:');
  const id = addNote(Date.now(), 'Test Entry', 'This is a test note.');
  console.log('Inserted ID:', id);
}

module.exports = {
  addNote,
  deleteNoteById,
  deleteNoteByTimestamp,
  getAllNotes,
};