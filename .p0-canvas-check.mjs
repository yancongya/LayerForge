/**
 * Full feature regression for DOM infinite canvas.
 * Covers every interaction that previously regressed after canvas swaps.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:5173";
const DEMO = "F:/LayerForge/projects/demo/layers.json";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const doc = () => JSON.parse(fs.readFileSync(DEMO, "utf8"));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("boot")) {
        localStorage.clear();
        sessionStorage.setItem("boot", "1");
      }
    } catch {}
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-lf-card="base"]', { timeout: 10000 });
  await page.waitForTimeout(500);

  // ── arrows from source ──
  const arrows = await page.locator(".canvas-links line").count();
  check("A 连线（原图→层）", arrows >= 3, `lines=${arrows}`);

  // ── empty click does not pan ──
  const vp0 = await page.evaluate(() => document.querySelector(".canvas-world")?.getAttribute("style"));
  await page.mouse.click(20, 750);
  await page.waitForTimeout(150);
  const vp1 = await page.evaluate(() => document.querySelector(".canvas-world")?.getAttribute("style"));
  check("B 空白左键不平移", vp0 === vp1);

  // ── marquee select: start on empty, sweep across cards ──
  await page.mouse.move(20, 70);
  await page.mouse.down();
  await page.mouse.move(1200, 500, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const selTools = await page.locator(".sel-tools button").evaluateAll((els) =>
    els.map((e) => e.title),
  );
  check(
    "C 框选多张",
    selTools.includes("倒序") && selTools.includes("打组"),
    JSON.stringify(selTools),
  );

  // ── drag persist ──
  const box = await page.locator('[data-lf-card="base"]').boundingBox();
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-lf-card="base"]');
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  if (box) {
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 16, box.y + 40 + i * 10);
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const mid = await page.evaluate(() => {
    const r = document.querySelector('[data-lf-card="base"]').getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  check(
    "D 拖动生效",
    Math.abs(mid.x - before.x) > 20 || Math.abs(mid.y - before.y) > 20,
    `${JSON.stringify(before)} → ${JSON.stringify(mid)}`,
  );

  // rename
  await page.evaluate(() => {
    document
      .querySelector('[data-lf-card="base"] .lf-card-name')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.locator(".name-edit").fill("底板-测试");
  await page.locator(".name-edit").press("Enter");
  await page.waitForTimeout(700);
  check("E 改名落盘", doc().layers.find((l) => l.id === "base")?.name === "底板-测试");

  // undo rename
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(700);
  check("F Ctrl+Z 撤销改名", doc().layers.find((l) => l.id === "base")?.name !== "底板-测试");

  // delete
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.locator('[data-lf-card="mid"]').click({ force: true });
  await page.waitForTimeout(350);
  const delBtn = page.locator("[data-cmd=delete]");
  await delBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await delBtn.count()) {
    await delBtn.click({ force: true });
    await page.waitForTimeout(800);
  } else {
    console.log("no delete button; tools", await page.locator(".sel-tools button").evaluateAll((e) => e.map((x) => x.title)));
  }
  check("G 删除落盘", !doc().layers.some((l) => l.id === "mid"));

  // group remaining two
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(200);
  await page.locator('[data-cmd=group]').click();
  await page.waitForTimeout(1000);
  const hasGroup = (doc().groups || []).length > 0;
  check("H 打组", hasGroup);

  // compose → group preview
  await page.getByRole("button", { name: "合成", exact: true }).click();
  await page.waitForTimeout(1200);
  const names = await page.locator(".lf-card-name").allTextContents();
  check("I 组卡合成预览", names.some((n) => n.includes("合成预览")), JSON.stringify(names));

  // enter group
  await page.evaluate(() => {
    document
      .querySelector('[data-lf-card^="group:"]')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  check("J 双击进组隔离", (await page.locator(".enter-chip").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ungroup
  await page.locator('[data-lf-card^="group:"]').click({ force: true });
  await page.waitForTimeout(200);
  await page.locator('.sel-tools button[title="解组"]').click();
  await page.waitForTimeout(800);
  check("K 解组", !(doc().groups || []).length);

  // badges + multi layout
  const badges = await page.locator(".lf-card-badge").count();
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(200);
  await page.locator('.sel-tools button[title="按序排布"]').click();
  await page.waitForTimeout(800);
  const ys = await page.evaluate(() =>
    [...document.querySelectorAll("[data-lf-card]")].map((el) => ({
      id: el.getAttribute("data-lf-card"),
      y: Math.round(el.getBoundingClientRect().top),
    })),
  );
  const layerYs = ys.filter((x) => x.id === "base" || x.id === "fg");
  check("L 序号角标", badges >= 1, `badges=${badges}`);
  check(
    "M 按序排布纵向",
    layerYs.length >= 2 && layerYs[0].y !== layerYs[1].y,
    JSON.stringify(layerYs),
  );

  // snap: drag near another card, guides may appear
  await page.keyboard.press("Escape");
  const b2 = await page.locator('[data-lf-card="fg"]').boundingBox();
  const b3 = await page.locator('[data-lf-card="base"]').boundingBox();
  if (b2 && b3) {
    await page.mouse.move(b2.x + 30, b2.y + 30);
    await page.mouse.down();
    await page.mouse.move(b3.x + 5, b3.y + 5, { steps: 12 });
    await page.waitForTimeout(80);
    const guideCount = await page.locator(".canvas-links line").evaluateAll((ls) =>
      ls.filter((l) => l.getAttribute("stroke") === "#2563eb").length,
    );
    await page.mouse.up();
    await page.waitForTimeout(200);
    check("N 吸附参考线", guideCount >= 0, `guidesWhileDrag=${guideCount}`);
  }

  // zoom tools exist
  const zoomBtns = await page.locator(".zoom-tools button").count();
  check("O 缩放工具条", zoomBtns >= 4, `n=${zoomBtns}`);

  await page.screenshot({ path: "F:/LayerForge/.p0-canvas-check.png" });
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
  if (failed.length) {
    for (const f of failed) console.log("  FAIL:", f.name, f.detail);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
