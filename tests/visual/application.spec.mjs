import { test, expect } from "@playwright/test";
import { installMockBackend, fixtureIDs } from "./mock-backend.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const scenes = [
  {
    name: "dashboard-graph",
    route: "dash",
    view: "dash",
    ready: "#attnBody .vg-feed",
  },
  {
    name: "dashboard-statistics",
    route: "dash",
    view: "dash",
    ready: "#dashBody .card[data-dcard=fin]",
    statistics: true,
  },
  {
    name: "dispatcher",
    route: "planner/orders",
    view: "planner",
    ready: "#orderList .kcard",
  },
  {
    name: "request",
    route: "job/" + fixtureIDs.job,
    view: "job",
    ready: "#jobOrders .order-children",
  },
  {
    name: "task",
    route: "order/" + fixtureIDs.order,
    view: "order",
    ready: "#orderEditor .order-grid",
  },
  {
    name: "trip",
    route: "trip/" + fixtureIDs.trip,
    view: "trip",
    ready: "#tpReviewSummary",
  },
  { name: "catalog", route: "catalog", view: "catalog", ready: "#catList" },
  { name: "settings", route: "settings", view: "settings", ready: "#stCur" },
];
for (const role of ["logist", "engineer", "admin"])
  for (const source of scenes.filter((s) =>
    role === "admin"
      ? s.name === "settings"
      : role === "logist"
        ? s.name !== "settings"
        : ["dashboard-graph", "task", "trip"].includes(s.name),
  )) {
    const scene =
      role === "engineer" && source.name === "dashboard-graph"
        ? {
            ...source,
            route: "planner/mine",
            view: "planner",
            ready: "#plMine .vg-feed",
          }
        : source;
    test(`${role} ${scene.name}`, async ({ page, context }, testInfo) => {
      const errors = [],
        remoteAPIs = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === "http://127.0.0.1:4173") return route.continue();
        if (
          url.hostname.includes("supabase") ||
          url.pathname.includes("/rest/v1/") ||
          url.pathname.includes("/auth/v1/")
        )
          remoteAPIs.push(url.origin + url.pathname);
        return route.abort();
      });
      await page.clock.setFixedTime(new Date("2026-10-05T07:00:00Z"));
      await page.addInitScript(installMockBackend, {
        role,
        theme: testInfo.project.metadata.theme,
      });
      await page.goto("/#/" + scene.route);
      const active = page.locator(".view-" + scene.view + ".active");
      await expect(active).toBeVisible();
      await page.locator("#todayLater").click();
      await expect(page.locator(".overlay.on")).toHaveCount(0);
      if (scene.statistics && testInfo.project.use.viewport.width <= 900)
        await active.locator("[data-dv=cards]").click();
      await expect(active.locator(scene.ready)).toBeVisible();
      await expect(active.locator(".shim")).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      if (scene.name === "catalog")
        await expect(active.locator("#catList")).toContainText(
          "Диагностика гидросистемы",
        );
      if (scene.statistics) {
        await expect(
          active.locator("[data-dcard=fin] .coverage"),
        ).toContainText("подтверждённый факт по 1 из 2");
        await expect(active.locator("[data-dcard=fin] .hero")).toContainText(
          "350",
        );
      }
      const paths = join(
        "test-results",
        "visual-screenshots",
        testInfo.project.name,
      );
      mkdirSync(paths, { recursive: true });
      const png = join(paths, `${role}-${scene.name}.png`);
      await page.screenshot({
        path: png,
        animations: "disabled",
        caret: "hide",
      });
      await testInfo.attach("viewport", {
        path: png,
        contentType: "image/png",
      });
      const measurements = await page.evaluate(() => {
        const view = document.querySelector(".view.active"),
          pane = view.querySelector(".pane");
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          viewWidth: Math.round(view.getBoundingClientRect().width),
          paneWidth: pane?.clientWidth,
          paneScrollWidth: pane?.scrollWidth,
          theme: document.documentElement.dataset.theme,
          blockedWrites: window.__visualQA.blockedWrites,
          reads: window.__visualQA.reads,
        };
      });
      writeFileSync(
        join(paths, `${role}-${scene.name}.json`),
        JSON.stringify(measurements, null, 2),
      );
      expect(remoteAPIs, "No production API traffic").toEqual([]);
      expect(errors, "No uncaught runtime errors").toEqual([]);
      expect(measurements.blockedWrites, "No attempted fixture writes").toEqual(
        [],
      );
      expect(
        measurements.documentWidth,
        "No document horizontal overflow",
      ).toBeLessThanOrEqual(measurements.viewport + 1);
      expect(
        measurements.bodyWidth,
        "No body horizontal overflow",
      ).toBeLessThanOrEqual(measurements.viewport + 1);
      if (measurements.paneWidth)
        expect(
          measurements.paneScrollWidth,
          "Only schedule/table/kanban regions may scroll horizontally",
        ).toBeLessThanOrEqual(measurements.paneWidth + 1);
      expect(measurements.theme).toBe(testInfo.project.metadata.theme);
      await expect(page.locator("#authOverlay")).not.toHaveClass(/\bon\b/);
      await expect(active).not.toContainText("Не удалось загрузить");
      if (scene.statistics) {
        if (!(await active.locator(".load-chart").isVisible()))
          await active
            .getByRole("button", { name: "По дням", exact: true })
            .click();
        await active.locator(".load-chart").scrollIntoViewIfNeeded();
        const chartShot = join(paths, `${role}-${scene.name}-chart.png`);
        await page.screenshot({
          path: chartShot,
          animations: "disabled",
          caret: "hide",
        });
        await testInfo.attach("load-chart", {
          path: chartShot,
          contentType: "image/png",
        });
        await active.getByText("Данные по дням", { exact: true }).click();
        await expect(active.locator(".chart-data table")).toBeVisible();
        const tableHeader = active.locator(".chart-data thead");
        await tableHeader.evaluate((header) => {
          header.scrollIntoView({
            block: "start",
            inline: "nearest",
            behavior: "instant",
          });
          for (
            let parent = header.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (
              parent.scrollHeight > parent.clientHeight &&
              getComputedStyle(parent).overflowY === "auto"
            ) {
              parent.scrollTop +=
                header.getBoundingClientRect().top -
                parent.getBoundingClientRect().top -
                140;
            }
          }
        });
        await expect(tableHeader.locator("th").first()).toBeInViewport({
          ratio: 1,
        });
        const tableShot = join(paths, `${role}-${scene.name}-data.png`);
        await page.screenshot({
          path: tableShot,
          animations: "disabled",
          caret: "hide",
        });
        await testInfo.attach("daily-data", {
          path: tableShot,
          contentType: "image/png",
        });
      }
      if (scene.name === "task") {
        await active.locator('a[href="#orderExecution"]').click();
        await expect(active.locator("#orderExecution")).toBeVisible();
        const shot = join(paths, `${role}-task-result.png`);
        await page.screenshot({
          path: shot,
          animations: "disabled",
          caret: "hide",
        });
        await testInfo.attach("task-result", {
          path: shot,
          contentType: "image/png",
        });
      }
      if (scene.name === "trip") {
        await active.locator("#tpReviewPresence").click();
        await expect(active.locator(".wb-table")).toBeVisible();
        const shot = join(paths, `${role}-trip-presence.png`);
        await page.screenshot({
          path: shot,
          animations: "disabled",
          caret: "hide",
        });
        await testInfo.attach("presence", {
          path: shot,
          contentType: "image/png",
        });
      }
      expect(remoteAPIs, "No production API traffic after navigation").toEqual([]);
      expect(errors, "No runtime errors after navigation").toEqual([]);
      expect(await page.evaluate(() => window.__visualQA.blockedWrites), "No writes after navigation").toEqual([]);
    });
  }
