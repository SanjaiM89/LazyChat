/**
 * The test data directory.
 *
 * Importing this module first points the application's data directory at a
 * throwaway folder, so a test never writes into the real one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omnia-test-data-"));
process.env.DATA_DIR = dir;

process.on("exit", () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

export const TEST_DATA_DIR = dir;
