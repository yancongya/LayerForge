/**
 * Explode-board layout for LayerForge canvas.
 *
 * Adapted from reference/editable-design `layer-editor.js` makeExplodedBoard():
 * - horizontal board, no big centered base
 * - overview + layer tiles as equal units
 * - lane columns (2–5) sized by unit count, balance weights, vertical stacking
 *
 * Plus reference/designjs `findPlacement` top-row gap: keep rows predictable
 * and never rely on drifting y from the previous unit.
 */

export type LayoutUnit = {
  id: string;
  role: "overview" | "layer";
  x: number;
  y: number;
  w: number;
  h: number;
  lane: number;
};

export type ExplodeLayout = {
  units: LayoutUnit[];
  width: number;
  height: number;
  overview: LayoutUnit | null;
  layers: LayoutUnit[];
};

const CARD_W = 280;
const CARD_H = 373;
const GAP = 48;
const MARGIN = 64;

/** Card size kept uniform so tiles read as one board (editable-design scale cap). */
export function explodeLayout(layerCount: number): ExplodeLayout {
  const n = Math.max(layerCount, 1);
  // Lane count: fewer units → 2 cols; more → up to 5 (same rule as explode.mjs).
  const laneCount = Math.max(2, Math.min(5, Math.ceil((n + 1) / 3)));
  const boardW = MARGIN * 2 + laneCount * CARD_W + (laneCount - 1) * GAP;
  // Stack height: max items in a lane ≈ ceil(units/laneCount)
  const maxRows = Math.max(2, Math.ceil((n + 1) / laneCount));
  const boardH = MARGIN * 2 + maxRows * CARD_H + (maxRows - 1) * GAP;

  // Slot 0 = overview (source), remaining = layers in order.
  // Prefer layer i near lane proportional to index — keeps topology readable.
  const slots: Array<{ id: string; role: "overview" | "layer"; desired: number }> = [];
  slots.push({ id: "source", role: "overview", desired: 0 });
  for (let i = 0; i < n; i++) {
    slots.push({
      id: `layer:${i}`,
      role: "layer",
      desired: n === 1 ? laneCount - 1 : Math.round((i / Math.max(1, n - 1)) * (laneCount - 1)),
    });
  }

  const lanes: Array<typeof slots> = Array.from({ length: laneCount }, () => []);
  const weights = Array(laneCount).fill(0);

  // Overview pinned to lane 0 (like designjs y:0 / leftmost predictability).
  lanes[0].push(slots[0]);
  weights[0] += 1.1;

  for (const rec of slots.slice(1)) {
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < laneCount; i++) {
      const score = weights[i] + Math.abs(i - rec.desired) * 0.28;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    lanes[best].push(rec);
    weights[best] += 1;
  }

  const units: LayoutUnit[] = [];
  for (let li = 0; li < laneCount; li++) {
    const items = lanes[li];
    if (!items.length) continue;
    // Stable vertical order: overview first, then layer index.
    items.sort((a, b) => {
      const ar = a.role === "overview" ? -1 : Number(a.id.split(":")[1]);
      const br = b.role === "overview" ? -1 : Number(b.id.split(":")[1]);
      return ar - br;
    });
    const laneX = MARGIN + li * (CARD_W + GAP);
    const stackH = items.length * CARD_H + (items.length - 1) * GAP;
    const y0 = (boardH - stackH) / 2;
    items.forEach((item, row) => {
      units.push({
        id: item.id,
        role: item.role,
        x: laneX,
        y: y0 + row * (CARD_H + GAP),
        w: CARD_W,
        h: CARD_H,
        lane: li,
      });
    });
  }

  return {
    units,
    width: boardW,
    height: boardH,
    overview: units.find((u) => u.role === "overview") ?? null,
    layers: units.filter((u) => u.role === "layer"),
  };
}

/**
 * Multi-column pack for real canvas cards (P1-B).
 * Same lane heuristic as explodeLayout: 2–5 columns, load-balanced by height,
 * deterministic top→bottom / left→right. Used by sel-tools「多列」.
 */
export function packCards(
  cards: Array<{ id: string; w: number; h: number }>,
  opts: { gap?: number } = {},
): Array<{ id: string; x: number; y: number }> {
  const gap = opts.gap ?? 48;
  const n = cards.length;
  if (n === 0) return [];
  const laneCount = Math.max(1, Math.min(5, Math.ceil(n / 3) || 1));
  const lanes: Array<Array<{ id: string; w: number; h: number }>> = Array.from(
    { length: laneCount },
    () => [],
  );
  const heights = Array(laneCount).fill(0);
  for (const card of cards) {
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < laneCount; i++) {
      const score = heights[i] + (i === 0 ? 0.15 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    lanes[best].push(card);
    heights[best] += card.h + gap;
  }

  // Column x: accumulate max width per lane so cards in a lane share x.
  const laneX: number[] = [];
  let x = 0;
  for (const lane of lanes) {
    laneX.push(x);
    const maxW = lane.reduce((m, c) => Math.max(m, c.w), 0);
    x += maxW + gap;
  }

  const out: Array<{ id: string; x: number; y: number }> = [];
  lanes.forEach((lane, li) => {
    let y = 0;
    for (const card of lane) {
      out.push({ id: card.id, x: laneX[li], y });
      y += card.h + gap;
    }
  });
  return out;
}
