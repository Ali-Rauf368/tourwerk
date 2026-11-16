import { defineConfig, devices } from '@playwright/test';

// The e2e run uses its own ports and database so it never touches a running dev setup.
export const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://tourwerk@127.0.0.1:5442/tourwerk_e2e';
const API_PORT = 4610;
const WEB_PORT = 5201;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx ../../e2e/reset-db.ts && npx tsx src/server.ts',
      cwd: '../apps/api',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DATABASE_URL: E2E_DB, MONGO_URL: "", MYSQL_URL: '', JWT_SECRET: 'e2e-secret-e2e-secret', INTEGRATION_TOKEN: 'e2e-integration-token', SIM_SPEEDUP: '1500', SIM_TICK_MS: '40', SIM_FAIL_RATE: '0' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npx vite',
      cwd: '../apps/web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { WEB_PORT: String(WEB_PORT), TOURWERK_API: `http://127.0.0.1:${API_PORT}` },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
