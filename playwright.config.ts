import type { PlaywrightTestConfig } from '@playwright/test'
import { devices } from '@playwright/test'

const config: PlaywrightTestConfig = {
  expect: {
    timeout: 5 * 1000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['clipboard-read'],
      },
    },

    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     ignoreHTTPSErrors: true,
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         'security.certerrors.mitm.auto_enable_enterprise_roots': true,
    //         'security.enterprise_roots.enable': true,
    //       },
    //     },
    //   },
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //   },
    // },
  ],
  reporter: process.env.CI ? 'html' : 'line',
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  timeout: 30 * 1000,
  use: {
    actionTimeout: 0,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'yarn start',
      port: 5173,
    },
  ],
  workers: process.env.CI ? 1 : undefined,
}

export default config
