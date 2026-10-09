// Read-only final entity audit. First run npm run build, then this file.
// Owns port 4173; never reuses an existing server or changes production source.
import { chromium } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { installMockBackend, fixtureIDs } from './mock-backend.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(repo, process.env.ENTITY_AUDIT_OUTPUT || 'test-results/entity-ui-final');
const origin = 'http://127.0.0.1:4173';
const dimensions = [
  { name: 'mobile-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1440', width: 1440, height: 900, touch: false },
];
const roles = ['admin', 'logist', 'engineer'];
const themes = ['light', 'dark'];
const scenes = [
  { name: 'request', route: `job/${fixtureIDs.job}`, view: 'job', ready: '#jobTitle' },
  { name: 'task', route: `order/${fixtureIDs.order}`, view: 'order', ready: '#orderEditor .order-grid' },
  { name: 'taskactive', route: `order/${fixtureIDs.activeOrder}`, view: 'order', ready: '#orderRecordResult' },
  { name: 'trip', route: `trip/${fixtureIDs.trip}`, view: 'trip', ready: '#tpReviewSummary' },
];
const report = {
  startedAt: new Date().toISOString(), mode: 'production-dist-read-only',
  roles, dimensions, themes, scenes: [], measurements: [], fatalError: null,
};
let server, browser;

async function checkpoint() {
  await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2));
}

async function assertPortFree() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', error => reject(new Error(`Port 4173 unavailable: ${error.message}. Stop the other QA server first.`)));
    probe.listen(4173, '127.0.0.1', () => probe.close(resolvePromise));
  });
}

async function startServer() {
  await assertPortFree();
  server = spawn(process.execPath, ['tests/visual/server.mjs'], {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolvePromise, reject) => {
    let stdout = '', stderr = '';
    const timer = setTimeout(() => reject(new Error(`QA server startup timed out. ${stderr}`)), 15000);
    const finish = callback => { clearTimeout(timer); callback(); };
    server.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.includes('Visual QA build server:')) finish(resolvePromise);
    });
    server.stderr.on('data', chunk => { stderr += chunk.toString(); });
    server.once('error', error => finish(() => reject(error)));
    server.once('exit', code => finish(() => reject(new Error(`QA server exited (${code}): ${stderr}`))));
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolvePromise => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
}

async function measure(page, scene) {
  return page.evaluate(viewName => {
    const view = document.querySelector(`.view-${viewName}.active`);
    const pane = view?.querySelector('.pane');
    const qa = window.__visualQA;
    const result = {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewWidth: view?.getBoundingClientRect().width,
      paneWidth: pane?.clientWidth, paneScrollWidth: pane?.scrollWidth,
      paneHeight: pane?.clientHeight, paneScrollHeight: pane?.scrollHeight,
      scrollTop: pane?.scrollTop, theme: document.documentElement.dataset.theme,
      selectedTab: view?.querySelector('[data-entity-tab][aria-selected="true"]')?.dataset.entityTab,
      qaReady: qa?.ready === true, blockedWrites: qa?.blockedWrites || [],
      queryErrors: qa?.queryErrors || [], reads: qa?.reads || [],
    };
    result.horizontalOverflow = [];
    if (result.documentWidth > innerWidth + 1) result.horizontalOverflow.push('document');
    if (result.bodyWidth > innerWidth + 1) result.horizontalOverflow.push('body');
    if (result.viewWidth > innerWidth + 1) result.horizontalOverflow.push('view');
    if (result.paneScrollWidth > result.paneWidth + 1) result.horizontalOverflow.push('pane');
    return result;
  }, scene.view);
}

async function auditScene(dimension, theme, role, scene) {
  const project = `${dimension.name}-${theme}`;
  const folder = join(output, project, role, scene.name);
  await mkdir(folder, { recursive: true });
  const context = await browser.newContext({
    baseURL: origin, viewport: { width: dimension.width, height: dimension.height },
    deviceScaleFactor: 1, isMobile: dimension.touch, hasTouch: dimension.touch,
    locale: 'ru-RU', timezoneId: 'Europe/Kyiv', reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const entry = { project, role, scene: scene.name, tabs: [], screenshots: 0, runtimeErrors: [], remoteAPIs: [], remoteBlocked: [], error: null };
  report.scenes.push(entry);
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => entry.runtimeErrors.push(error.message));
  try {
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      entry.remoteBlocked.push(url.origin + url.pathname);
      if (url.hostname.includes('supabase') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/auth/v1/')) {
        entry.remoteAPIs.push(url.origin + url.pathname);
      }
      return route.abort();
    });
    await page.clock.setFixedTime(new Date('2026-10-05T07:00:00Z'));
    await page.addInitScript(installMockBackend, { role, theme, entityAudit: true });
    await page.goto(`/#/${scene.route}`);
    const active = page.locator(`.view-${scene.view}.active`);
    await active.waitFor({ state: 'visible' });
    if (await page.locator('#todayLater').isVisible()) await page.locator('#todayLater').click();
    await active.locator(scene.ready).first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.overlay.on') && !document.querySelector('.view.active .shim'));
    await page.evaluate(() => document.fonts.ready);
    const tabKeys = await active.locator('[data-entity-tab]:visible').evaluateAll(elements => elements.map(element => ({
      key: element.dataset.entityTab, label: element.textContent.trim(), disabled: element.disabled,
    })));
    if (!tabKeys.length) throw new Error('Entity has no visible tabs');
    const pane = active.locator('.pane').first();
    for (const tab of tabKeys) {
      entry.tabs.push(tab);
      if (tab.disabled) continue;
      await active.locator(`[data-entity-tab="${tab.key}"]:visible`).click();
      await page.waitForFunction(({ view, key }) => {
        const root = document.querySelector(`.view-${view}.active`);
        return root?.querySelector(`[data-entity-tab="${key}"]`)?.getAttribute('aria-selected') === 'true' && !root.querySelector('.shim');
      }, { view: scene.view, key: tab.key });
      // A feed may load after the tab has activated. Wait for its real loading text.
      await page.waitForFunction(view => [...document.querySelectorAll(`.view-${view}.active .entity-activity-feed`)]
        .every(feed => !feed.getClientRects().length || !/^Загруж/.test(feed.querySelector(':scope > .hint')?.textContent || '')), scene.view);
      await pane.evaluate(element => { element.scrollTop = 0; });
      await settle(page);
      let step = 0;
      while (true) {
        const measurement = await measure(page, scene);
        const screenshot = join(folder, `${tab.key}-${String(step).padStart(2, '0')}.png`);
        await page.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
        entry.screenshots++;
        report.measurements.push({ project, role, scene: scene.name, tab: tab.key, step, screenshot, ...measurement });
        if (measurement.scrollTop + measurement.paneHeight >= measurement.paneScrollHeight - 1) break;
        const moved = await pane.evaluate(element => {
          const before = element.scrollTop;
          element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, before + Math.max(1, Math.floor(element.clientHeight * 0.8)));
          return element.scrollTop > before;
        });
        if (!moved) throw new Error(`Pane stopped scrolling before the bottom (${tab.key})`);
        if (++step > 100) throw new Error(`Excessive scroll steps (${tab.key})`);
        await settle(page);
      }
    }
    entry.final = await measure(page, scene);
  } catch (error) {
    entry.error = error.stack || error.message;
    await page.screenshot({ path: join(folder, 'failure.png'), animations: 'disabled' }).catch(() => {});
    entry.final = await measure(page, scene).catch(() => null);
  } finally {
    entry.remoteAPIs = [...new Set(entry.remoteAPIs)];
    entry.remoteBlocked = [...new Set(entry.remoteBlocked)];
    await context.close();
    await checkpoint();
    console.log(`${project} ${role} ${scene.name}: ${entry.error ? 'FAILED' : `${entry.tabs.length} tabs, ${entry.screenshots} screenshots`}`);
  }
}

try {
  await access(join(repo, 'dist/index.html'));
  await mkdir(output, { recursive: true });
  await startServer();
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  for (const dimension of dimensions) for (const theme of themes) for (const role of roles) for (const scene of scenes) {
    await auditScene(dimension, theme, role, scene);
  }
} catch (error) {
  report.fatalError = error.stack || error.message;
  console.error(report.fatalError);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) server.kill('SIGTERM');
  await mkdir(output, { recursive: true });
  report.finishedAt = new Date().toISOString();
  report.summary = {
    expectedScenes: dimensions.length * themes.length * roles.length * scenes.length,
    scenes: report.scenes.length,
    states: report.scenes.reduce((count, scene) => count + scene.tabs.filter(tab => !tab.disabled).length, 0),
    screenshots: report.scenes.reduce((count, scene) => count + scene.screenshots, 0),
    sceneErrors: report.scenes.filter(scene => scene.error).length,
    runtimeErrors: report.scenes.flatMap(scene => scene.runtimeErrors).length,
    blockedWrites: report.scenes.flatMap(scene => scene.final?.blockedWrites || []).length,
    queryErrors: report.scenes.flatMap(scene => scene.final?.queryErrors || []).length,
    remoteAPIs: report.scenes.flatMap(scene => scene.remoteAPIs).length,
    overflowScreenshots: report.measurements.filter(measurement => measurement.horizontalOverflow.length).length,
    themeErrors: report.measurements.filter(measurement => measurement.theme !== measurement.project.split('-').at(-1)).length,
    missingMock: report.measurements.filter(measurement => !measurement.qaReady).length,
  };
  await checkpoint();
  await writeFile(join(output, 'summary.json'), JSON.stringify(report.summary, null, 2));
  console.log(JSON.stringify(report.summary));
  if (report.fatalError || report.summary.scenes !== report.summary.expectedScenes ||
    ['sceneErrors', 'runtimeErrors', 'blockedWrites', 'queryErrors', 'remoteAPIs', 'overflowScreenshots', 'themeErrors', 'missingMock'].some(key => report.summary[key])) process.exitCode = 1;
}
