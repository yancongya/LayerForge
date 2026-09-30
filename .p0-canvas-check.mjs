/**
 * Canvas acceptance for the DOM infinite-canvas host.
 * Usage: node F:/LayerForge/.p0-canvas-check.mjs  (dev server on :5173)
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:5173";
const DEMO_JSON = "F:/LayerForge/projects/demo/layers.json";
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function readDoc() {
  return JSON.parse(fs.readFileSync(DEMO_JSON, "utf8"));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("lf-booted")) {
        localStorage.clear();
        sessionStorage.setItem("lf-booted", "1");
      }
    } catch {}
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector('[data-lf-card="base"]', { timeout: 10000 });
  await page.waitForTimeout(600);

  const getPos = () =>
    page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-lf-card]")) {
        const id = el.getAttribute("data-lf-card") || "";
        const r = el.getBoundingClientRect();
        out[id] = { x: Math.round(r.left), y: Math.round(r.top) };
      }
      return out;
    });

  // 1 drag persist
  const beforePos = await getPos();
  const box = await page.locator('[data-lf-card="base"]').boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(cx + i * 18, cy + i * 12);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  const midPos = await getPos();
  // rename via name
  await page.evaluate(() => {
    document
      .querySelector('[data-lf-card="base"] .lf-card-name')
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(200);
  const input = page.locator(".name-edit");
  await input.waitFor({ timeout: 2000 });
  await input.fill("底板-测试");
  await input.press("Enter");
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "组映射", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-lf-card="base"]', { timeout: 10000 });
  await page.waitForTimeout(800);
  const afterPos = await getPos();
  const dragged =
    beforePos.base &&
    midPos.base &&
    (Math.abs(midPos.base.x - beforePos.base.x) > 30 ||
      Math.abs(midPos.base.y - beforePos.base.y) > 30);
  const persisted =
    midPos.base &&
    afterPos.base &&
    Math.abs(afterPos.base.x - midPos.base.x) < 50 &&
    Math.abs(afterPos.base.y - midPos.base.y) < 50;
  check(
    "1 拖位持久",
    Boolean(box && dragged && persisted),
    `pre=${JSON.stringify(beforePos.base)} mid=${JSON.stringify(midPos.base)} post=${JSON.stringify(afterPos.base)}`,
  );
  const nameOk = readDoc().layers.find((l) => l.id === "base")?.name === "底板-测试";
  check("1b 改名落盘", nameOk);

  // 2 no zombies (all cards are our data-lf-card keys)
  const cardKeys = await page.evaluate(() =>
    [...document.querySelectorAll("[data-lf-card]")].map((e) => e.getAttribute("data-lf-card")),
  );
  const bad = cardKeys.filter(
    (k) => k !== "source" && !["base", "mid", "fg"].includes(k) && !k.startsWith("group:"),
  );
  check("2 无僵尸卡", bad.length === 0, JSON.stringify(cardKeys));

  // 3 single toolbar + delete
  await page.locator('[data-lf-card="mid"]').click();
  await page.waitForTimeout(300);
  const tb = await page.locator(".sel-tools").count();
  const del = page.locator('.sel-tools button[title="删除此层"]');
  check("3a 单一工具条", tb === 1, `sel-tools=${tb}`);
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(1000);
  }
  check("3 删除落盘", !readDoc().layers.some((l) => l.id === "mid"));

  // 4 group + compose preview
  await page.locator('[data-lf-card="base"]').click();
  await page.keyboard.down("Shift");
  await page.locator('[data-lf-card="fg"]').click({ force: true });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
  const groupBtn = page.locator('.sel-tools button[title="打组"]');
  if (await groupBtn.count()) {
    await groupBtn.click();
    await page.waitForTimeout(1200);
  }
  await page.getByRole("button", { name: "合成", exact: true }).click();
  await page.waitForTimeout(1500);
  const names = await page.locator(".lf-card-name").allTextContents();
  const hasPreview = names.some((n) => n.includes("合成预览"));
  const gid = (readDoc().groups || []).map((g) => g.id)[0];
  check(
    "4 合成预览在组节点",
    hasPreview,
    `names=${JSON.stringify(names)} gid=${gid}`,
  );
  check(
    "4b 组级合成文件",
    Boolean(gid) && fs.existsSync(`F:/LayerForge/projects/demo/groups/${gid}.png`),
    gid || "no group",
  );

  // 5 aspect
  const aspectOk = readDoc().layers.every((l) => {
    if (!l.imgW || !l.imgH || !l.w || !l.h) return true;
    return Math.abs(l.imgW / l.imgH - l.w / l.h) < 0.02;
  });
  check("5 卡片比例匹配图片", aspectOk);

  // 6 group/ungroup
  const groupCard = page.locator('[data-lf-card^="group:"]');
  if (await groupCard.count()) {
    await page.evaluate(() => {
      document
        .querySelector('[data-lf-card^="group:"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);
    const chip = await page.locator(".enter-chip").count();
    check("6a 双击进组", chip === 1);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const ungroup = page.locator('.sel-tools button[title="解组"]');
    // click group then ungroup via tool or we need junction - use double-click enter then exit then ungroup button
    await page.locator('[data-lf-card^="group:"]').first().click();
    await page.waitForTimeout(300);
    if (await page.locator('.sel-tools button[title="解组"]').count()) {
      await page.locator('.sel-tools button[title="解组"]').click();
      await page.waitForTimeout(1000);
    }
    const afterU = readDoc();
    check("6b 解组", !afterU.groups?.length, `groups=${JSON.stringify(afterU.groups)}`);
  } else {
    check("6a 双击进组", false, "no group card");
    check("6b 解组", false, "no group");
  }

  // 7 badges + multi tools
  const badges = await page.locator(".lf-card-badge").allTextContents();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  // stacked cards overlap after ungroup — select all layers via Ctrl+A
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(300);
  const multi = await page
    .locator(".sel-tools button")
    .evaluateAll((els) => els.map((e) => e.title));
  console.log("multi tools", multi);
  check(
    "7 序号 + 多选排序工具",
    badges.length > 0 &&
      multi.includes("倒序") &&
      multi.includes("按序排布") &&
      multi.includes("多列排布"),
    `badges=${JSON.stringify(badges)} multi=${JSON.stringify(multi)}`,
  );

  await page.screenshot({ path: "F:/LayerForge/.p0-canvas-check.png", fullPage: true });
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
