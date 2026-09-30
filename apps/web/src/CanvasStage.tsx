import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { packCards } from "./layout";
import type { Layer, LayerGroup } from "./types";

export type LayoutItem = { id: string; x: number; y: number; w: number; h: number };

export type CanvasApi = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo100: () => void;
  selectLayer: (id: string) => void;
};

type Props = {
  projectId: string;
  layers: Layer[];
  groups: LayerGroup[];
  sourceUrl?: string | null;
  compositeUrl?: string | null;
  onGroup: (memberIds: string[]) => void;
  onUngroup: (groupId: string) => void;
  onMoveOrder: (layerId: string, dir: "up" | "down") => void;
  onReverseOrder?: (layerIds: string[]) => void;
  onRename?: (layerId: string, name: string) => void;
  onRenameGroup?: (groupId: string, name: string) => void;
  onDeleteLayer?: (layerId: string) => void;
  onSetFlags?: (
    layerId: string,
    flags: { visible?: boolean; locked?: boolean; opacity?: number },
  ) => void;
  onSaveLayout?: (layers: LayoutItem[], groups: LayoutItem[]) => void;
  onZoom?: (z: number) => void;
  showMinimap?: boolean;
};

type Card = {
  key: string;
  name: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orderN?: number;
  dim?: boolean;
  locked?: boolean;
  kind: "source" | "layer" | "group";
};

const NODE_W = 280;
const DEFAULT_H = 373;
const GAP = 80;

function cardBox(w?: number, h?: number, imgW?: number, imgH?: number) {
  if (w && h && w > 0 && h > 0) return { w, h };
  if (imgW && imgH && imgW > 0 && imgH > 0) {
    return { w: NODE_W, h: Math.max(1, (NODE_W * imgH) / imgW) };
  }
  return { w: NODE_W, h: DEFAULT_H };
}

function isPlaced(x?: number, y?: number, imgW?: number) {
  return !((x ?? 0) === 0 && (y ?? 0) === 0 && (imgW ?? 0) === 0);
}

type Viewport = { x: number; y: number; z: number };

const CanvasStage = forwardRef<CanvasApi, Props>(function CanvasStage(
  {
    projectId,
    layers,
    groups,
    sourceUrl,
    compositeUrl,
    onGroup,
    onUngroup,
    onMoveOrder,
    onReverseOrder,
    onRename,
    onRenameGroup,
    onDeleteLayer,
    onSetFlags,
    onSaveLayout,
    onZoom,
    showMinimap = true,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, z: 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toolPos, setToolPos] = useState<{ x: number; y: number } | null>(null);
  const [minimap] = useState(showMinimap);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const enteredRef = useRef(enteredGroupId);
  enteredRef.current = enteredGroupId;

  const layoutTimer = useRef<number | null>(null);
  const lastSaved = useRef("");
  const wroteBack = useRef<Set<string>>(new Set());
  const dragRef = useRef<{
    key: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const spaceRef = useRef(false);
  const [cardPos, setCardPos] = useState<Record<string, { x: number; y: number }>>({});
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeRef = useRef<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null>(null);
  const [guides, setGuides] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);

  const camKey = `lf:cam:${projectId}`;
  const srcKey = `lf:srcpos:${projectId}`;

  // ── build cards from layers.json (single source of truth) ──────────
  const cards = useMemo(() => {
    const ordered = [...layers].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const entered = enteredGroupId;
    const out: Card[] = [];
    const srcPos = (() => {
      try {
        const raw = localStorage.getItem(srcKey);
        if (!raw) return null;
        const p = JSON.parse(raw) as { x?: number; y?: number };
        return typeof p.x === "number" && typeof p.y === "number" ? p : null;
      } catch {
        return null;
      }
    })();

    if (sourceUrl) {
      out.push({
        key: "source",
        name: "原图",
        url: sourceUrl,
        x: srcPos?.x ?? -420,
        y: srcPos?.y ?? 40,
        w: 280,
        h: 373,
        dim: Boolean(entered),
        kind: "source",
      });
    }

    const free = ordered.filter((l) => !l.groupId);
    const groupedVisible = entered
      ? ordered.filter((l) => l.groupId === entered)
      : [];
    const showLayers = entered ? [...groupedVisible, ...free] : free;
    const bright = new Set(groupedVisible.map((l) => l.id));

    showLayers.forEach((layer, idx) => {
      const box = cardBox(layer.w, layer.h, layer.imgW, layer.imgH);
      const placed = isPlaced(layer.x, layer.y, layer.imgW);
      const dim = entered ? !bright.has(layer.id) : false;
      out.push({
        key: layer.id,
        name: layer.name,
        url: layer.url,
        x: placed ? (layer.x ?? 0) : idx * (NODE_W + GAP),
        y: placed ? (layer.y ?? 0) : 0,
        w: box.w,
        h: box.h,
        orderN: dim ? undefined : (entered ? [...bright].indexOf(layer.id) : free.indexOf(layer)) + 1 || undefined,
        dim,
        locked: Boolean(layer.locked) || dim,
        kind: "layer",
      });
    });

    if (!entered) {
      groups
        .filter((g) => ordered.some((l) => l.groupId === g.id))
        .forEach((g) => {
          const members = ordered.filter((l) => l.groupId === g.id);
          const cover = members[0];
          const box = cardBox(g.w, g.h, g.imgW || cover?.imgW, g.imgH || cover?.imgH);
          const placed = isPlaced(g.x, g.y, g.imgW || cover?.imgW);
          const preview = g.previewUrl ?? compositeUrl ?? cover?.url;
          out.push({
            key: `group:${g.id}`,
            name: preview !== cover?.url ? `${g.name} · 合成预览` : g.name,
            url: preview ?? cover?.url ?? "",
            x: placed ? (g.x ?? 0) : 0,
            y: placed ? (g.y ?? 0) : 0,
            w: box.w,
            h: box.h,
            dim: false,
            kind: "group",
          });
        });
    }
    return out;
  }, [layers, groups, sourceUrl, compositeUrl, enteredGroupId, srcKey]);

  // findPlacement write-back for unplaced layers
  useEffect(() => {
    if (!onSaveLayout) return;
    const items: LayoutItem[] = [];
    let right = 0;
    for (const c of cards) {
      if (c.kind !== "layer" || c.dim) continue;
      const layer = layers.find((l) => l.id === c.key);
      if (!layer || isPlaced(layer.x, layer.y, layer.imgW)) {
        right = Math.max(right, c.x + c.w);
        continue;
      }
      const x = right > 0 ? right + GAP : 0;
      const y = 0;
      items.push({ id: c.key, x, y, w: c.w, h: c.h });
      right = x + c.w;
    }
    if (items.length && !wroteBack.current.has(items[0].id)) {
      wroteBack.current.add(items[0].id);
      onSaveLayout(items, []);
    }
  }, [cards, layers, onSaveLayout]);

  const scheduleSave = useCallback(() => {
    if (!onSaveLayout) return;
    if (layoutTimer.current != null) window.clearTimeout(layoutTimer.current);
    layoutTimer.current = window.setTimeout(() => {
      layoutTimer.current = null;
      const layerItems: LayoutItem[] = [];
      const groupItems: LayoutItem[] = [];
      for (const c of viewCardsRef.current) {
        const item = { id: c.key.replace(/^group:/, ""), x: c.x, y: c.y, w: c.w, h: c.h };
        if (c.kind === "group") groupItems.push(item);
        else if (c.kind === "layer" && !c.dim) layerItems.push(item);
      }
      const key = JSON.stringify({ l: layerItems, g: groupItems });
      if (key === lastSaved.current) return;
      lastSaved.current = key;
      onSaveLayout(layerItems, groupItems);
    }, 250);
  }, [onSaveLayout]);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  /** Local drag offsets; cleared when layers.json props catch up. */
  const viewCards = useMemo(
    () =>
      cards.map((c) => {
        const p = cardPos[c.key];
        return p ? { ...c, x: p.x, y: p.y } : c;
      }),
    [cards, cardPos],
  );
  const viewCardsRef = useRef(viewCards);
  viewCardsRef.current = viewCards;

  useEffect(() => {
    setCardPos({});
  }, [layers, groups]);

  // Double-click via click-count (more reliable than native dblclick under capture)
  const lastClickRef = useRef<{ key: string; t: number; name: boolean } | null>(null);

  const handleCardAction = useCallback((key: string, fromName: boolean) => {
    if (key === "source") return;
    if (key.startsWith("group:")) {
      if (fromName) setEditingId(key);
      else setEnteredGroupId(key.slice(6));
      return;
    }
    setEditingId(key);
  }, []);

  const applyDrag = useCallback(
    (keys: string[], primaryKey: string, nx: number, ny: number) => {
      const primary = viewCardsRef.current.find((c) => c.key === primaryKey);
      if (!primary) return;
      const ddx = nx - primary.x;
      const ddy = ny - primary.y;
      setCardPos((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          const c = viewCardsRef.current.find((x) => x.key === k);
          if (!c || c.locked) continue;
          if (k === primaryKey) next[k] = { x: nx, y: ny };
          else {
            const base = prev[k] ?? { x: c.x, y: c.y };
            next[k] = { x: base.x + ddx, y: base.y + ddy };
          }
        }
        return next;
      });
    },
    [],
  );

  // ── viewport ───────────────────────────────────────────────────────
  const zoomAt = useCallback((cx: number, cy: number, zNext: number) => {
    setViewport((v) => {
      const z = Math.max(0.1, Math.min(4, zNext));
      const ratio = z / v.z;
      return {
        z,
        x: cx - (cx - v.x) * ratio,
        y: cy - (cy - v.y) * ratio,
      };
    });
  }, []);

  const fit = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const list = cardsRef.current;
    if (!list.length) {
      setViewport({ x: 40, y: 40, z: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of list) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h + 28);
    }
    const pad = 48;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const r = el.getBoundingClientRect();
    const z = Math.max(0.1, Math.min(4, Math.min(r.width / bw, r.height / bh)));
    setViewport({
      z,
      x: r.width / 2 - ((minX + maxX) / 2) * z,
      y: r.height / 2 - ((minY + maxY) / 2) * z,
    });
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    zoomIn: () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, viewportRef.current.z * 1.25);
    },
    zoomOut: () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, viewportRef.current.z / 1.25);
    },
    zoomTo100: () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, 1);
    },
    selectLayer: (id: string) => {
      const key = id.startsWith("group:") ? id : id;
      setSelected([key]);
      const c = cardsRef.current.find((x) => x.key === key);
      const el = rootRef.current;
      if (!c || !el) return;
      const r = el.getBoundingClientRect();
      setViewport((v) => ({
        ...v,
        x: r.width / 2 - (c.x + c.w / 2) * v.z,
        y: r.height / 2 - (c.y + c.h / 2) * v.z,
      }));
    },
  }));

  useEffect(() => {
    onZoom?.(viewport.z);
  }, [viewport.z, onZoom]);

  // restore camera once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(camKey);
      if (raw) {
        const cam = JSON.parse(raw) as Viewport;
        if (typeof cam.x === "number" && typeof cam.y === "number" && typeof cam.z === "number") {
          setViewport(cam);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(fit, 80);
    return () => window.clearTimeout(t);
  }, [camKey, fit]);

  useEffect(() => {
    try {
      localStorage.setItem(camKey, JSON.stringify(viewport));
    } catch {
      /* ignore */
    }
  }, [viewport, camKey]);

  // ── world helpers ──────────────────────────────────────────────────
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = rootRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const v = viewportRef.current;
    return {
      x: (clientX - r.left - v.x) / v.z,
      y: (clientY - r.top - v.y) / v.z,
    };
  }, []);

  // ── pointer: card drag / pan / wheel zoom ──────────────────────────
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const next = viewportRef.current.z * (e.deltaY > 0 ? 0.9 : 1.1);
        zoomAt(cx, cy, next);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".sel-tools, .enter-chip, .name-edit, .zoom-tools, button")) {
        return;
      }
      const cardEl = target.closest("[data-lf-card]") as HTMLElement | null;
      // Pan only with space / middle button. Left-drag empty = marquee select.
      const isPan = spaceRef.current || e.button === 1;
      if (!isPan && !cardEl && e.button === 0) {
        const w = toWorld(e.clientX, e.clientY);
        marqueeRef.current = {
          x0: w.x,
          y0: w.y,
          x1: w.x,
          y1: w.y,
          additive: e.shiftKey || e.metaKey || e.ctrlKey,
        };
        setMarquee({ x: w.x, y: w.y, w: 0, h: 0 });
        if (!marqueeRef.current.additive) setSelected([]);
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (isPan) {
        panRef.current = {
          x: e.clientX,
          y: e.clientY,
          vx: viewportRef.current.x,
          vy: viewportRef.current.y,
        };
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (!cardEl || e.button !== 0) return;
      const key = cardEl.dataset.lfCard!;
      const card = cardsRef.current.find((c) => c.key === key);
      if (!card) return;
      const fromName = Boolean((e.target as HTMLElement).closest(".lf-card-name"));
      // double-click detection on pointerup (see onPointerUp)
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        setSelected((prev) =>
          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
        );
      } else {
        setSelected((prev) => (prev.includes(key) ? prev : [key]));
      }
      if (card.locked && !fromName) return;
      const w = toWorld(e.clientX, e.clientY);
      dragRef.current = {
        key,
        startX: w.x,
        startY: w.y,
        origX: card.x,
        origY: card.y,
        moved: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (panRef.current) {
        const p = panRef.current;
        setViewport((v) => ({
          ...v,
          x: p.vx + (e.clientX - p.x),
          y: p.vy + (e.clientY - p.y),
        }));
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        const w = toWorld(e.clientX, e.clientY);
        m.x1 = w.x;
        m.y1 = w.y;
        const x = Math.min(m.x0, m.x1);
        const y = Math.min(m.y0, m.y1);
        const bw = Math.abs(m.x1 - m.x0);
        const bh = Math.abs(m.y1 - m.y0);
        setMarquee({ x, y, w: bw, h: bh });
        const hit = viewCardsRef.current
          .filter((c) => {
            if (c.locked && c.kind === "source") return false;
            return !(c.x + c.w < x || c.x > x + bw || c.y + c.h < y || c.y > y + bh);
          })
          .map((c) => c.key);
        setSelected(m.additive ? Array.from(new Set([...selectedRef.current, ...hit])) : hit);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const w = toWorld(e.clientX, e.clientY);
      let nx = d.origX + (w.x - d.startX);
      let ny = d.origY + (w.y - d.startY);
      const self = viewCardsRef.current.find((c) => c.key === d.key);
      const sw = self?.w ?? 280;
      const sh = self?.h ?? 373;
      // snap to other cards (8px screen → world)
      const snapR = 8 / Math.max(viewportRef.current.z, 0.1);
      const g: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      for (const c of viewCardsRef.current) {
        if (c.key === d.key) continue;
        const ax = c.x;
        const axc = c.x + c.w / 2;
        const axr = c.x + c.w;
        const ay = c.y;
        const ayc = c.y + c.h / 2;
        const ayb = c.y + c.h;
        const bx = nx;
        const bxc = nx + sw / 2;
        const bxr = nx + sw;
        const by = ny;
        const byc = ny + sh / 2;
        const byb = ny + sh;
        if (Math.abs(bx - ax) < snapR) {
          nx = ax;
          g.push({ x1: ax, y1: Math.min(by, ay) - 24, x2: ax, y2: Math.max(byb, ayb) + 24 });
        } else if (Math.abs(bxc - axc) < snapR) {
          nx = axc - sw / 2;
          g.push({ x1: axc, y1: Math.min(by, ay) - 24, x2: axc, y2: Math.max(byb, ayb) + 24 });
        } else if (Math.abs(bxr - axr) < snapR) {
          nx = axr - sw;
          g.push({ x1: axr, y1: Math.min(by, ay) - 24, x2: axr, y2: Math.max(byb, ayb) + 24 });
        }
        if (Math.abs(by - ay) < snapR) {
          ny = ay;
          g.push({ x1: Math.min(bx, ax) - 24, y1: ay, x2: Math.max(bxr, axr) + 24, y2: ay });
        } else if (Math.abs(byc - ayc) < snapR) {
          ny = ayc - sh / 2;
          g.push({ x1: Math.min(bx, ax) - 24, y1: ayc, x2: Math.max(bxr, axr) + 24, y2: ayc });
        } else if (Math.abs(byb - ayb) < snapR) {
          ny = ayb - sh;
          g.push({ x1: Math.min(bx, ax) - 24, y1: ayb, x2: Math.max(bxr, axr) + 24, y2: ayb });
        }
      }
      setGuides(g.slice(0, 6));
      if (!d.moved && Math.abs(w.x - d.startX) + Math.abs(w.y - d.startY) > 2) {
        d.moved = true;
        el.setPointerCapture(e.pointerId);
      }
      if (!d.moved) return;
      const keys = selectedRef.current.includes(d.key) ? selectedRef.current : [d.key];
      applyDrag(keys, d.key, nx, ny);
    };

    const onPointerUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d?.moved) scheduleSave();
      // treat as double-click when two quick pointerups on same card without drag
      if (d && !d.moved) {
        const now = Date.now();
        const prev = lastClickRef.current;
        const fromName = Boolean((e.target as HTMLElement).closest(".lf-card-name"));
        if (prev && prev.key === d.key && now - prev.t < 350) {
          lastClickRef.current = null;
          handleCardAction(d.key, fromName || prev.name);
        } else {
          lastClickRef.current = { key: d.key, t: now, name: fromName };
        }
      }
      dragRef.current = null;
      panRef.current = null;
      marqueeRef.current = null;
      setMarquee(null);
      setGuides([]);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [toWorld, zoomAt, scheduleSave, applyDrag, handleCardAction]);

  // ── keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        spaceRef.current = true;
        if (rootRef.current) rootRef.current.style.cursor = "grab";
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (enteredRef.current) setEnteredGroupId(null);
        else setSelected([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        setSelected(cardsRef.current.filter((c) => c.kind === "layer" && !c.dim).map((c) => c.key));
        return;
      }
      if (e.key.startsWith("Arrow")) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (!selectedRef.current.length) return;
        e.preventDefault();
        setCardPos((prev) => {
          const next = { ...prev };
          for (const k of selectedRef.current) {
            const c = viewCardsRef.current.find((x) => x.key === k);
            if (!c || c.locked) continue;
            const base = next[k] ?? { x: c.x, y: c.y };
            next[k] = { x: base.x + dx, y: base.y + dy };
          }
          return next;
        });
        scheduleSave();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceRef.current = false;
        if (rootRef.current) rootRef.current.style.cursor = "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [scheduleSave]);

  // clear cardPos when layers prop catches up
  useEffect(() => {
    setCardPos({});
  }, [layers, groups]);

  // ── selection tools ────────────────────────────────────────────────
  const align = (mode: "left" | "centerX" | "right" | "top" | "middleY" | "bottom") => {
    const list = viewCards.filter((c) => selected.includes(c.key) && !c.locked);
    if (list.length < 2) return;
    const minX = Math.min(...list.map((c) => c.x));
    const maxX = Math.max(...list.map((c) => c.x + c.w));
    const minY = Math.min(...list.map((c) => c.y));
    const maxY = Math.max(...list.map((c) => c.y + c.h));
    setCardPos((prev) => {
      const next = { ...prev };
      for (const c of list) {
        let x = c.x;
        let y = c.y;
        if (mode === "left") x = minX;
        if (mode === "centerX") x = (minX + maxX) / 2 - c.w / 2;
        if (mode === "right") x = maxX - c.w;
        if (mode === "top") y = minY;
        if (mode === "middleY") y = (minY + maxY) / 2 - c.h / 2;
        if (mode === "bottom") y = maxY - c.h;
        next[c.key] = { x, y };
      }
      return next;
    });
    scheduleSave();
  };

  const layoutByOrder = () => {
    const free = viewCards
      .filter((c) => c.kind === "layer" && !c.dim)
      .sort((a, b) => (a.orderN ?? 0) - (b.orderN ?? 0));
    let y = 0;
    setCardPos((prev) => {
      const next = { ...prev };
      for (const c of free) {
        next[c.key] = { x: 0, y };
        y += c.h + GAP;
      }
      return next;
    });
    scheduleSave();
  };

  const layoutByColumns = () => {
    const free = viewCards
      .filter((c) => c.kind === "layer" && !c.dim)
      .sort((a, b) => (a.orderN ?? 0) - (b.orderN ?? 0));
    const packed = packCards(free.map((c) => ({ id: c.key, w: c.w, h: c.h })), { gap: GAP });
    setCardPos((prev) => {
      const next = { ...prev };
      for (const p of packed) next[p.id] = { x: p.x, y: p.y };
      return next;
    });
    scheduleSave();
  };

  const stackNow = () => {
    const list = viewCards.filter((c) => selected.includes(c.key) && c.kind === "layer");
    if (list.length < 2) return;
    const x0 = Math.min(...list.map((c) => c.x));
    const y0 = Math.min(...list.map((c) => c.y));
    setCardPos((prev) => {
      const next = { ...prev };
      list.forEach((c, i) => {
        next[c.key] = { x: x0 + i * 16, y: y0 + i * 16 };
      });
      return next;
    });
    scheduleSave();
  };

  // group selection → tools
  const selLayerIds = selected.filter((k) => !k.startsWith("group:") && k !== "source");
  const selGroup =
    selected.find((k) => k.startsWith("group:"))?.slice(6) ??
    (enteredGroupId || null);

  // tool position above selection in screen space
  useEffect(() => {
    const list = viewCards.filter((c) => selected.includes(c.key));
    const el = rootRef.current;
    if (!list.length || !el) {
      setToolPos(null);
      return;
    }
    const minX = Math.min(...list.map((c) => c.x));
    const maxX = Math.max(...list.map((c) => c.x + c.w));
    const minY = Math.min(...list.map((c) => c.y));
    const v = viewport;
    setToolPos({
      x: v.x + ((minX + maxX) / 2) * v.z,
      y: v.y + minY * v.z - 10,
    });
  }, [selected, viewCards, viewport]);

  // svg arrows: source → each non-source card
  const sourceCard = viewCards.find((c) => c.key === "source");
  const arrows = sourceCard
    ? viewCards
        .filter((c) => c.key !== "source")
        .map((c) => ({
          key: c.key,
          x1: sourceCard.x + sourceCard.w,
          y1: sourceCard.y + sourceCard.h / 2,
          x2: c.x,
          y2: c.y + c.h / 2,
          dim: Boolean(c.dim),
        }))
    : [];

  const commitName = (value: string) => {
    const name = value.trim();
    const id = editingId;
    setEditingId(null);
    if (!name || !id || id === "source") return;
    if (id.startsWith("group:")) onRenameGroup?.(id.slice(6), name);
    else onRename?.(id, name);
  };

  return (
    <div className="canvas-stage" ref={rootRef}>
      <div
        className="canvas-world"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.z})`,
          transformOrigin: "0 0",
        }}
      >
        <svg className="canvas-links" aria-hidden>
          {guides.map((g, i) => (
            <line
              key={`g${i}`}
              x1={g.x1}
              y1={g.y1}
              x2={g.x2}
              y2={g.y2}
              stroke="#2563eb"
              strokeWidth={1.5 / viewport.z}
              opacity={0.85}
            />
          ))}
          {arrows.map((a) => (
            <line
              key={a.key}
              x1={a.x1}
              y1={a.y1}
              x2={a.x2}
              y2={a.y2}
              stroke="rgba(24,24,27,0.75)"
              strokeWidth={2 / viewport.z}
              opacity={a.dim ? 0.2 : 0.85}
              markerEnd="url(#lf-arrow)"
            />
          ))}
          <defs>
            <marker id="lf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="rgba(24,24,27,0.75)" />
            </marker>
          </defs>
        </svg>
        {marquee && (
          <div
            className="lf-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
            }}
          />
        )}

        {viewCards.map((c) => (
          <div
            key={c.key}
            data-lf-card={c.key}
            className={`lf-card ${c.kind} ${selected.includes(c.key) ? "is-sel" : ""} ${c.dim ? "is-dim" : ""}`}
            style={{ left: c.x, top: c.y, width: c.w, height: c.h }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleCardAction(c.key, false);
            }}
          >
            <img className="lf-card-img" src={c.url} alt="" draggable={false} />
            {c.orderN != null && <div className="lf-card-badge">{c.orderN}</div>}
            <div
              className="lf-card-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                handleCardAction(c.key, true);
              }}
            >
              {c.name}
            </div>
          </div>
        ))}
      </div>

      {enteredGroupId && (
        <div className="enter-chip">
          <button type="button" onClick={() => setEnteredGroupId(null)}>
            ← 退出组
          </button>
          <span>{groups.find((g) => g.id === enteredGroupId)?.name ?? enteredGroupId}</span>
        </div>
      )}

      {minimap && viewCards.length > 0 && (
        <div className="lf-minimap" aria-hidden>
          {viewCards.map((c) => (
            <i
              key={c.key}
              style={{
                left: `${((c.x + 600) / 2400) * 100}%`,
                top: `${((c.y + 400) / 1600) * 100}%`,
                width: `${(c.w / 2400) * 100}%`,
                height: `${(c.h / 1600) * 100}%`,
                opacity: c.dim ? 0.25 : 0.85,
              }}
            />
          ))}
        </div>
      )}

      {selLayerIds.length > 0 && !selGroup && toolPos && (
        <div
          className="sel-tools"
          style={{ left: toolPos.x, top: toolPos.y, transform: "translate(-50%, -100%)" }}
        >
          {selLayerIds.length === 1 && (
            <div className="tool-group" data-group="layer">
              <button type="button" title="层序↑" onClick={() => onMoveOrder(selLayerIds[0], "up")}>
                ↑
              </button>
              <button type="button" title="层序↓" onClick={() => onMoveOrder(selLayerIds[0], "down")}>
                ↓
              </button>
              <button
                type="button"
                title="锁定/解锁"
                onClick={() => {
                  const layer = layers.find((l) => l.id === selLayerIds[0]);
                  if (!layer) return;
                  onSetFlags?.(layer.id, { locked: !layer.locked });
                }}
              >
                {layers.find((l) => l.id === selLayerIds[0])?.locked ? "🔒" : "🔓"}
              </button>
              <button
                type="button"
                title="删除此层"
                data-cmd="delete"
                onClick={() => {
                  const id = selLayerIds[0];
                  if (id) onDeleteLayer?.(id);
                }}
              >
                ✕
              </button>
            </div>
          )}
          {selLayerIds.length >= 2 && (
            <>
              <div className="tool-group" data-group="order">
                <button type="button" title="倒序" onClick={() => onReverseOrder?.(selLayerIds)}>
                  ⇅
                </button>
                <button type="button" title="按序排布" onClick={layoutByOrder}>
                  ≡↓
                </button>
                <button type="button" title="多列排布" onClick={layoutByColumns}>
                  ▦
                </button>
              </div>
              <div className="tool-group" data-group="align">
                <button type="button" title="左对齐" onClick={() => align("left")}>
                  ⬅
                </button>
                <button type="button" title="水平中" onClick={() => align("centerX")}>
                  ⇹
                </button>
                <button type="button" title="右对齐" onClick={() => align("right")}>
                  ➡
                </button>
                <button type="button" title="顶对齐" onClick={() => align("top")}>
                  ⬆
                </button>
                <button type="button" title="垂直中" onClick={() => align("middleY")}>
                  ⇳
                </button>
                <button type="button" title="底对齐" onClick={() => align("bottom")}>
                  ⬇
                </button>
              </div>
              <div className="tool-group" data-group="action">
                <button
                  type="button"
                  className="primary icon-btn"
                  title="打组"
                  data-cmd="group"
                  onClick={() => {
                    stackNow();
                    onGroup(selLayerIds);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    <rect x="2" y="6" width="9" height="7" rx="1.2" stroke="currentColor" fill="none" />
                    <rect x="4" y="3.5" width="9" height="7" rx="1.2" stroke="currentColor" fill="#fff" />
                    <rect x="6" y="1.5" width="8" height="7" rx="1.2" stroke="currentColor" fill="#fff" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {editingId && (
        <input
          className="name-edit"
          autoFocus
          defaultValue={
            viewCards.find((c) => c.key === editingId)?.name ?? ""
          }
          style={{
            left: (viewport.x + (viewCards.find((c) => c.key === editingId)?.x ?? 0) * viewport.z),
            top:
              viewport.y +
              ((viewCards.find((c) => c.key === editingId)?.y ?? 0) +
                (viewCards.find((c) => c.key === editingId)?.h ?? 0) +
                4) *
                viewport.z,
            width: (viewCards.find((c) => c.key === editingId)?.w ?? 200) * viewport.z,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => commitName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitName(e.currentTarget.value);
            if (e.key === "Escape") setEditingId(null);
          }}
        />
      )}

      {selGroup && !selLayerIds.length && (
        <div
          className="sel-tools"
          style={{ left: toolPos?.x ?? 24, top: toolPos?.y ?? 24, transform: "translate(-50%, -100%)" }}
        >
          <div className="tool-group" data-group="action">
            <button type="button" title="解组" onClick={() => onUngroup(selGroup)}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="2" y="2" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="9" y="2" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="2" y="9" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="9" y="9" width="5" height="5" stroke="currentColor" fill="none" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default CanvasStage;
