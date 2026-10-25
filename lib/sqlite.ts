// @ts-ignore - node:sqlite types not shipped
const { DatabaseSync } = require("node:sqlite");
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/data-dir";

const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, "chat.db");

let db: any = null;

export function getDb(): any {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      org_id TEXT,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_owner ON conversations(owner_id);

    -- Append-only session history: one row per durable fact about a
    -- conversation (a turn, a step, a tool call, an approval, a compaction).
    -- The log is the source of truth for history; the conversation row keeps
    -- metadata only.
    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      run_id TEXT,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_conv ON session_events(conversation_id, seq);
    CREATE INDEX IF NOT EXISTS idx_events_run ON session_events(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_events_type ON session_events(type);

    -- Full-text mirror of the log, kept in sync by triggers. session_search
    -- and session_event_search read this.
    CREATE VIRTUAL TABLE IF NOT EXISTS session_events_fts USING fts5(
      conversation_id UNINDEXED,
      type UNINDEXED,
      data,
      content='session_events',
      content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS session_events_ai AFTER INSERT ON session_events BEGIN
      INSERT INTO session_events_fts(rowid, conversation_id, type, data)
      VALUES (new.id, new.conversation_id, new.type, new.data);
    END;
    CREATE TRIGGER IF NOT EXISTS session_events_ad AFTER DELETE ON session_events BEGIN
      INSERT INTO session_events_fts(session_events_fts, rowid, conversation_id, type, data)
      VALUES ('delete', old.id, old.conversation_id, old.type, old.data);
    END;
  `);
  return db;
}

export function closeDb() {
  if (db) { db.close(); db = null; }
}
