import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    include: ["src/**/*.test.ts"],
    // Each test file copies the schema template into its own database file, so
    // files are free to run in parallel.
    testTimeout: 20000,
  },
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
});
