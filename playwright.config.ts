import { defineConfig, devices } from '@playwright/test';

// Dedicated port so the suite never collides with a real server on 3000.
const PORT     = Number(process.env.E2E_PORT || 3999);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // One shared SQLite DB + socket.io broadcasts: tests must not run in parallel.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    locale: 'es-AR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } },
  ],
  webServer: {
    // Resets tests/.db, signs a test license there and starts server.js on PORT.
    command: 'node tests/support/start-test-server.js',
    url: `${BASE_URL}/login.html`,
    env: { PORT: String(PORT) },
    // Always start a fresh server so every run gets a clean database.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
