import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Point the session log and the app's data root at throwaway locations.
 * Imported first, so the environment is set before the modules that read it
 * are evaluated.
 */
const dbPath = path.join(os.tmpdir(), `omnia-events-${process.pid}.db`);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `omnia-data-${process.pid}-`));
process.env.SQLITE_PATH = dbPath;
process.env.DATA_DIR = dataDir;

export const TEST_DB_PATH = dbPath;
export const TEST_DATA_DIR = dataDir;
