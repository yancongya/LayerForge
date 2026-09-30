/**
 * P0 canvas acceptance checks (Playwright).
 * Usage: node F:/LayerForge/.p0-canvas-check.mjs
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

function shapeSel(id) {
  return `[data-shape-id="shape:lf-${id}"]`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.addInitScript(() => {
    try {
      // Clear camera only on first boot; keep it across reload so we compare apples to apples.
      if (!sessionStorage.getItem("lf-booted")) {
        localStorage.clear();
        sessionStorage.setItem("lf-booted", "1");
      }
    } catch {}
  });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector(shapeSel("base"), { timeout: 10000 });
  await page.waitForTimeout(600);

  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[class*='watermark'], [title*='license']")) {
      el.style.pointerEvents = "none";
    }
  });

  const getPos = () =>
    page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll("[data-shape-id]")) {
        const id = el.getAttribute("data-shape-id") || "";
        if (!id.includes("lf-") || id.includes("lf-a-") || id.includes("lf-n-")) continue;
        const r = el.getBoundingClientRect();
        out[id] = { x: Math.round(r.left), y: Math.round(r.top) };
      }
      return out;
    });

  // ---------- 1. Drag persistence ----------
  const beforePos = await getPos();
  const card = page.locator(shapeSel("base"));
  const box = await card.boundingBox();
  console.log("drag box", box);
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
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(700);
  const midPos = await getPos();
  console.log("after drag", midPos["shape:lf-base"], "was", beforePos["shape:lf-base"]);
  console.log("json after drag", readDoc().layers.map((l) => [l.id, l.x, l.y]));

  const nameStick = page.locator(".name-stick", { hasText: "Base" }).first();
  if (await nameStick.count()) {
    await nameStick.dblclick();
    const input = page.locator(".name-edit");
    await input.waitFor({ timeout: 2000 });
    await input.fill("底板-测试");
    await input.press("Enter");
    await page.waitForTimeout(800);
  }

  await page.getByRole("button", { name: "组映射", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.waitForTimeout(500);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector(shapeSel("base"), { timeout: 10000 });
  await page.waitForTimeout(800);

  const afterPos = await getPos();
  const baseBefore = beforePos["shape:lf-base"];
  const baseMid = midPos["shape:lf-base"];
  const baseAfter = afterPos["shape:lf-base"];
  const dragged =
    baseBefore && baseMid
      ? Math.abs(baseMid.x - baseBefore.x) > 30 || Math.abs(baseMid.y - baseBefore.y) > 30
      : false;
  const persisted =
    baseMid && baseAfter
      ? Math.abs(baseAfter.x - baseMid.x) < 50 && Math.abs(baseAfter.y - baseMid.y) < 50
      : false;
  check(
    "1 拖位持久",
    Boolean(box && dragged && persisted),
    `pre=(${baseBefore?.x},${baseBefore?.y}) mid=(${baseMid?.x},${baseMid?.y}) post=(${baseAfter?.x},${baseAfter?.y})`,
  );

  const doc1 = readDoc();
  const baseLayer = doc1.layers.find((l) => l.id === "base");
  check("1b 改名落盘", baseLayer?.name === "底板-测试", `name=${baseLayer?.name}`);

  // ---------- 2. No zombie / shadow group ----------
  const countManaged = () =>
    page.evaluate(() => {
      const ids = [];
      for (const el of document.querySelectorAll("[data-shape-id]")) {
        const id = el.getAttribute("data-shape-id") || "";
        if (id.includes("lf-") && !id.includes("lf-a-")) ids.push(id);
      }
      return ids;
    });

  await page.keyboard.press("Control+a");
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+g");
  await page.waitForTimeout(300);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "组映射", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await page.waitForTimeout(600);

  const idsAfter = await countManaged();
  const allowed = new Set([
    "shape:lf-source",
    "shape:lf-base",
    "shape:lf-mid",
    "shape:lf-fg",
    "shape:lf-composite",
  ]);
  const zombies = idsAfter.filter(
    (id) => !allowed.has(id) && !id.startsWith("shape:lf-group:"),
  );
  const hasCompositeCard = idsAfter.includes("shape:lf-composite");
  check(
    "2 无僵尸卡无影子组",
    zombies.length === 0,
    `zombies=${JSON.stringify(zombies)} compositeCard=${hasCompositeCard} all=${JSON.stringify(idsAfter)}`,
  );

  // ---------- 3. Delete persists ----------
  await page.locator(shapeSel("mid")).click();
  await page.waitForTimeout(400);
  // unified toolbar should be the only one
  const tbCount = await page.locator(".sel-tools").count();
  const imageToolbar = await page.locator("[data-testid*='image-toolbar'], .tlui-toolbar[data-testid*='image']").count();
  const delBtn = page.locator('.sel-tools button[title="删除此层"]');
  check("3a 单一工具条", tbCount === 1, `sel-tools=${tbCount} imageToolbar=${imageToolbar}`);
  if (await delBtn.count()) {
    await delBtn.click();
    await page.waitForTimeout(1000);
  }
  const doc3 = readDoc();
  const hasMid = doc3.layers.some((l) => l.id === "mid");
  check("3 删除落盘", !hasMid, `layers=${doc3.layers.map((l) => l.id).join(",")}`);

  // ---------- 4. Composite preview on group node ----------
  await page.locator(shapeSel("base")).click();
  await page.waitForTimeout(250);
  await page.keyboard.down("Shift");
  await page.locator(shapeSel("fg")).click({ force: true });
  await page.keyboard.up("Shift");
  await page.waitForTimeout(400);
  const selToolTitles = await page.locator(".sel-tools button").evaluateAll((els) =>
    els.map((e) => e.getAttribute("title")),
  );
  console.log("sel tools", selToolTitles);
  const groupBtn = page.locator('.sel-tools button[title="打组"]');
  if (await groupBtn.count()) {
    await groupBtn.click();
    await page.waitForTimeout(1200);
  } else {
    console.log("no group button");
  }
  await page.getByRole("button", { name: "合成", exact: true }).click();
  await page.waitForTimeout(1500);

  const groupLabels = await page.locator(".name-stick").allTextContents();
  const hasGroupPreview = groupLabels.some((t) => t.includes("合成预览"));
  const stillHasFloatCard = await page.locator(shapeSel("composite")).count();
  check(
    "4 合成预览在组节点",
    hasGroupPreview && stillHasFloatCard === 0,
    `labels=${JSON.stringify(groupLabels)} floatCard=${stillHasFloatCard}`,
  );

  // P1-A: compose writes groups/<id>.png for the live group
  {
    const doc4 = readDoc();
    const gid = (doc4.groups || []).map((g) => g.id)[0];
    const previewPath = gid
      ? `F:/LayerForge/projects/demo/groups/${gid}.png`
      : null;
    check("4b 组级合成文件", Boolean(gid) && fs.existsSync(previewPath), previewPath || "no group");
  }

  // arrows must not leak across group/ungroup (locked arrows used to survive deleteShapes)
  const arrowIds = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-shape-id]")]
        .map((e) => e.getAttribute("data-shape-id") || "")
        .filter((id) => id.includes("lf-a-")),
    );
  const arrowsGrouped = await arrowIds();
  const ungroupBtn = page.locator('.sel-tools button[title="解组"]');
  const junction = page.locator(".junction-dot");
  if (await ungroupBtn.count()) {
    // select group card first
    await page.locator('[data-shape-id^="shape:lf-group:"]').first().click();
    await page.waitForTimeout(300);
    const ub = page.locator('.sel-tools button[title="解组"]');
    if (await ub.count()) await ub.click();
    else if (await junction.count()) await junction.first().click();
  } else if (await junction.count()) {
    await junction.first().click();
  }
  await page.waitForTimeout(1000);
  const arrowsUngrouped = await arrowIds();
  const shapeIds = await page.evaluate(() =>
    [...document.querySelectorAll("[data-shape-id]")].map((e) => e.getAttribute("data-shape-id")),
  );
  // while grouped: only arrows to group cards (no leftover member arrows)
  const memberArrowsLeaked = arrowsGrouped.filter((id) => !id.includes("group:"));
  // after ungroup: no leftover group arrows, every arrow has a living target
  const groupArrowsLeaked = arrowsUngrouped.filter((id) => id.includes("group:"));
  const dangling = arrowsUngrouped.filter((id) => {
    const target = id.replace("shape:lf-a-", "shape:lf-");
    return !shapeIds.includes(target);
  });
  check(
    "6 组/解组无幽灵连线",
    memberArrowsLeaked.length === 0 &&
      groupArrowsLeaked.length === 0 &&
      dangling.length === 0,
    `grouped=${JSON.stringify(arrowsGrouped)} ungrouped=${JSON.stringify(arrowsUngrouped)} memberLeak=${JSON.stringify(memberArrowsLeaked)} groupLeak=${JSON.stringify(groupArrowsLeaked)} dangling=${JSON.stringify(dangling)}`,
  );

  // ---------- 5. Image aspect ----------
  const doc5 = readDoc();
  const aspectOk = doc5.layers.every((l) => {
    if (!l.imgW || !l.imgH || !l.w || !l.h) return true;
    return Math.abs(l.imgW / l.imgH - l.w / l.h) < 0.02;
  });
  check("5 卡片比例匹配图片", aspectOk);

  // order badges + multi-only sort tools
  const badgeTexts = await page.locator(".order-badge").allTextContents();
  // clear selection then select one
  await page.keyboard.press("Escape");
  await page.locator(shapeSel("fg")).click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
  const singleTitles = await page
    .locator(".sel-tools button")
    .evaluateAll((els) => els.map((e) => e.title));
  const singleHasSort = singleTitles.includes("倒序") || singleTitles.includes("按序排布");
  // rubber-band select both free cards
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(1300, 800, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  const multiTitles = await page
    .locator(".sel-tools button")
    .evaluateAll((els) => els.map((e) => e.title));
  check(
    "7 序号角标 + 排序工具仅多选",
    badgeTexts.length > 0 &&
      !singleHasSort &&
      multiTitles.includes("倒序") &&
      multiTitles.includes("按序排布") &&
      multiTitles.includes("多列排布"),
    `badges=${JSON.stringify(badgeTexts)} single=${JSON.stringify(singleTitles)} multi=${JSON.stringify(multiTitles)}`,
  );

  // P1-A covered in 4b while a group exists

  await page.screenshot({ path: "F:/LayerForge/.p0-canvas-check.png", fullPage: true });
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} PASS ====`);
  if (failed.length) {
    for (const f of failed) console.log("  FAIL:", f.name, f.detail);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
