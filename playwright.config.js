import { defineConfig } from "@playwright/test";
const viewports = [
  { name: "mobile-360", width: 360, height: 800, touch: true },
  { name: "mobile-390", width: 390, height: 844, touch: true },
  { name: "tablet-768", width: 768, height: 1024, touch: true },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  timeout: 45000,
  expect: { timeout: 10000 },
  outputDir: "test-results/visual",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/visual-report.json" }],
  ],
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:4173",
    locale: "ru-RU",
    timezoneId: "Europe/Kyiv",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  },
  projects: viewports.flatMap((v) =>
    ["light", "dark"].map((theme) => ({
      name: `${v.name}-${theme}`,
      metadata: { theme },
      use: {
        viewport: { width: v.width, height: v.height },
        isMobile: !!v.touch,
        hasTouch: !!v.touch,
      },
    })),
  ),
  webServer: {
    command: "npm run build && node tests/visual/server.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
