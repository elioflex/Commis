import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Each test process works on its own copy of data/: test files run in
// parallel and must never write the real store.
const dataDir = mkdtempSync(join(tmpdir(), "kamas-bot-test-"));
cpSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "data"), dataDir, { recursive: true });
process.env.DATA_DIR = dataDir;
