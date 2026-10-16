import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 120000,
    globalSetup: ["tests/unit/globalSetup.ts"],
    reporters: ["dot"],
  },
});
