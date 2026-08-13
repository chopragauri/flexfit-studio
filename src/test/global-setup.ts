import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

export const TEST_DB_DIR = ".test-dbs";
export const TEMPLATE_DB = `${TEST_DB_DIR}/template.db`;

/**
 * Builds one schema-only database that every test file copies. Applying the
 * schema is the slow part (it shells out to drizzle-kit), so it happens once
 * per run rather than once per file.
 */
export default function setup() {
  rmSync(TEST_DB_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DB_DIR, { recursive: true });

  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    env: { ...process.env, DB_FILE: `file:${TEMPLATE_DB}` },
    stdio: "pipe",
  });

  return () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  };
}
