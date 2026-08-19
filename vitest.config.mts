import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Matches the "@/*" path mapping in tsconfig.json. Declared directly
    // rather than via a plugin so the test config has no extra moving parts.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Every test here is a pure function. Anything needing a database belongs
    // in a separate integration suite with its own setup, not smuggled in here.
    passWithNoTests: false,
  },
});
