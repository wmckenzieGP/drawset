import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"]] : [["dot"]],
  use: { baseURL: "http://localhost:4173", viewport: { width: 1600, height: 1000 }, colorScheme: "dark" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
  webServer: { command: "npm run build:web && npm run preview", url: "http://localhost:4173", reuseExistingServer: !process.env.CI, timeout: 180000 },
});
