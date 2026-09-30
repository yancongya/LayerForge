import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AssetRecordType,
  TLImageShape,
  TLShapeId,
  TLUiActionsContextType,
  TLUiOverrides,
  TLUiToolsContextType,
  Tldraw,
  createShapeId,
  toRichText,
  type Editor,
  type TLArrowShape,
} from "tldraw";
import "tldraw/tldraw.css";
import { log } from "./log";
import type { Layer, LayerGroup } from "./types";

export type LayoutItem = { id: string; x: number; y: number; w: number; h: number };

export type CanvasApi = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
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
  onRename?: (layerId: string, name: string) => void;
  onRenameGroup?: (groupId: string, name: string) => void;
  onDeleteLayer?: (layerId: string) => void;
  onSetFlags?: (layerId: string, flags: { visible?: boolean; locked?: boolean }) => void;
  onSaveLayout?: (layers: LayoutItem[], groups: LayoutItem[]) => void;
};

/** Actions that must stay (selection / viewport / read-only export). Everything else is dropped. */
const KEEP_ACTIONS = new Set([
  "select-all",
  "select-none",
  "zoom-in",
  "zoom-out",
  "zoom-to-fit",
  "zoom-to-100",
  "zoom-to-selection",
  "toggle-grid",
  "toggle-snap-mode",
  "toggle-invert-zoom",
  "toggle-wrap-mode",
  "toggle-edge-scrolling",
  "toggle-focus-mode",
  "toggle-dark-mode",
  "toggle-reduce-motion",
  "toggle-dynamic-size-mode",
  "back-to-content",
  "change-page-next",
  "change-page-prev",
  "copy-as-png",
  "copy-as-svg",
  "copy-as-json",
  "export-as-png",
  "export-as-svg",
  "download-original",
  "print",
]);

const uiOverrides: TLUiOverrides = {
  tools(_editor: Editor, tools: TLUiToolsContextType) {
    const keep = new Set(["select", "hand", "zoom"]);
    for (const key of Object.keys(tools)) {
      if (!keep.has(key)) delete tools[key as keyof TLUiToolsContextType];
    }
    return tools;
  },
  actions(_editor: Editor, actions: TLUiActionsContextType) {
    for (const key of Object.keys(actions)) {
      const ok = KEEP_ACTIONS.has(key) || key.startsWith("a11y-");
      if (!ok) delete actions[key];
    }
    return actions;
  },
};

const NODE_W = 280;
const DEFAULT_NODE_H = 373;
const CARD_GAP = 80;

function metaOf(shape: { meta?: unknown }): { role?: string; layerId?: string; name?: string } {
  return (shape.meta as { role?: string; layerId?: string; name?: string }) ?? {};
}
function imgId(id: string): TLShapeId {
  return createShapeId(`lf-${id}`);
}
function arrowId(id: string): TLShapeId {
  return createShapeId(`lf-a-${id}`);
}

function cardBox(w?: number, h?: number, imgW?: number, imgH?: number) {
  if (w && h && w > 0 && h > 0) return { w, h };
  if (imgW && imgH && imgW > 0 && imgH > 0) {
    return { w: NODE_W, h: Math.max(1, (NODE_W * imgH) / imgW) };
  }
  return { w: NODE_W, h: DEFAULT_NODE_H };
}

function isPlaced(x?: number, y?: number, imgW?: number) {
  // Matches Layer.placed in layers.py: x=0,y=0 is valid once imgW is known.
  return !((x ?? 0) === 0 && (y ?? 0) === 0 && (imgW ?? 0) === 0);
}

function ensureAsset(
  editor: Editor,
  key: string,
  url: string,
  name: string,
  w: number,
  h: number,
) {
  const assetId = AssetRecordType.createId(key);
  const prev = editor.getAsset(assetId);
  const props = {
    src: url,
    w: w > 0 ? w : 720,
    h: h > 0 ? h : 960,
    name,
    mimeType: "image/png",
    isAnimated: false,
  };
  if (!prev) {
    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props,
        meta: { layerId: key },
      },
    ]);
  } else {
    const prevProps = prev.props as { src?: string | null; name?: string };
    if (prevProps.src !== url || prevProps.name !== name) {
      editor.updateAssets([
        { id: assetId, type: "image", typeName: "asset", props },
      ]);
    }
  }
  return assetId;
}

type Hub = { key: string; x: number; y: number; groupId: string };
type NameLabel = { key: string; name: string; x: number; y: number; w: number };

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
    onRename,
    onRenameGroup,
    onDeleteLayer,
    onSetFlags,
    onSaveLayout,
  },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef(layers);
  const groupsRef = useRef(groups);
  const sourceRef = useRef(sourceUrl);
  const compositeRef = useRef(compositeUrl);
  const didFitRef = useRef(false);
  const syncingRef = useRef(false);
  const layoutTimerRef = useRef<number | null>(null);
  const cameraTimerRef = useRef<number | null>(null);
  const [selLayers, setSelLayers] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [names, setNames] = useState<NameLabel[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toolPos, setToolPos] = useState<{ x: number; y: number } | null>(null);

  const commitRename = (n: NameLabel, value: string) => {
    setEditingId(null);
    const name = value.trim();
    if (!name || n.key === "source" || n.key === "composite") return;
    if (String(n.key).startsWith("group:")) onRenameGroup?.(String(n.key).slice(6), name);
    else onRename?.(n.key, name);
  };

  layersRef.current = layers;
  groupsRef.current = groups;
  sourceRef.current = sourceUrl;
  compositeRef.current = compositeUrl;

  useImperativeHandle(ref, () => ({
    fit: () => editorRef.current?.zoomToFit({ animation: { duration: 180 } }),
    zoomIn: () => editorRef.current?.zoomIn(undefined, { animation: { duration: 120 } }),
    zoomOut: () => editorRef.current?.zoomOut(undefined, { animation: { duration: 120 } }),
    selectLayer: (id: string) => {
      const editor = editorRef.current;
      const sid = imgId(id);
      if (editor?.getShape(sid)) {
        editor.select(sid);
        editor.zoomToSelection({ animation: { duration: 180 } });
      }
    },
  }));

  const cameraKey = `lf:cam:${projectId}`;

  const persistCamera = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      localStorage.setItem(cameraKey, JSON.stringify(editor.getCamera()));
    } catch {
      /* quota / private mode */
    }
  }, [cameraKey]);

  const restoreCamera = useCallback(
    (editor: Editor) => {
      try {
        const raw = localStorage.getItem(cameraKey);
        if (!raw) return false;
        const cam = JSON.parse(raw) as { x?: number; y?: number; z?: number };
        if (typeof cam.x !== "number" || typeof cam.y !== "number") return false;
        editor.setCamera({ x: cam.x, y: cam.y, z: typeof cam.z === "number" ? cam.z : 1 });
        return true;
      } catch {
        return false;
      }
    },
    [cameraKey],
  );

  const refreshHubs = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const collected: NameLabel[] = [];
    const pin = (key: string, name: string) => {
      const el = rootRef.current?.querySelector(`[data-shape-id="${imgId(key)}"]`);
      if (!el || !rootRef.current) return;
      const wr = rootRef.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      collected.push({
        key,
        name,
        x: r.left - wr.left,
        y: r.bottom - wr.top + 2,
        w: r.width,
      });
    };
    if (sourceRef.current) pin("source", "原图");
    for (const layer of layersRef.current) {
      if (layer.groupId) continue;
      pin(layer.id, layer.name);
    }
    for (const g of groupsRef.current) {
      pin(`group:${g.id}`, compositeRef.current ? `${g.name} · 合成预览` : g.name);
    }

    const chips: Hub[] = [];
    for (const g of groupsRef.current) {
      const img = editor.getShape(imgId(`group:${g.id}`)) as TLImageShape | undefined;
      if (!img) continue;
      const p = editor.pageToScreen({ x: img.x - 16, y: img.y + img.props.h / 2 });
      chips.push({ key: g.id, x: p.x, y: p.y, groupId: g.id });
    }
    setHubs(chips);
    setNames(collected);
  }, []);

  /** Last geometry we flushed to layers.json — skip no-op saves (breaks applyProject loops). */
  const lastSavedRef = useRef<string>("");
  const wroteBackRef = useRef<Set<string>>(new Set());

  const scheduleLayoutSave = useCallback(() => {
    if (!onSaveLayout) return;
    if (layoutTimerRef.current != null) window.clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = window.setTimeout(() => {
      layoutTimerRef.current = null;
      const editor = editorRef.current;
      if (!editor || syncingRef.current) return;
      const layerItems: LayoutItem[] = [];
      const groupItems: LayoutItem[] = [];
      for (const layer of layersRef.current) {
        if (layer.groupId) continue;
        const s = editor.getShape(imgId(layer.id)) as TLImageShape | undefined;
        if (!s) continue;
        layerItems.push({
          id: layer.id,
          x: s.x,
          y: s.y,
          w: s.props.w,
          h: s.props.h,
        });
      }
      for (const g of groupsRef.current) {
        const s = editor.getShape(imgId(`group:${g.id}`)) as TLImageShape | undefined;
        if (!s) continue;
        groupItems.push({ id: g.id, x: s.x, y: s.y, w: s.props.w, h: s.props.h });
      }
      if (!layerItems.length && !groupItems.length) return;
      const key = JSON.stringify({ l: layerItems, g: groupItems });
      if (key === lastSavedRef.current) return;
      lastSavedRef.current = key;
      log.debug("tldraw", "save layout", { layers: layerItems.length, groups: groupItems.length });
      onSaveLayout(layerItems, groupItems);
    }, 250);
  }, [onSaveLayout]);

  /**
   * Whitelist shape reconciliation: only managed cards / arrows survive.
   * Managed = source | free layer | group card | link arrow.
   * Everything else (paste / duplicate / drop orphans) is deleted, along with
   * assets no surviving shape references.
   */
  const syncGraph = useCallback(
    (editor: Editor) => {
      syncingRef.current = true;
      try {
        const ordered = [...layersRef.current].sort(
          (a, b) => a.order - b.order || a.id.localeCompare(b.id),
        );
        const src = sourceRef.current;
        const composite = compositeRef.current;
        const free = ordered.filter((l) => !l.groupId);
        const liveGroups = groupsRef.current.filter((g) =>
          ordered.some((l) => l.groupId === g.id),
        );

        const wantedShapes = new Set<TLShapeId>();
        const wantedKeys: string[] = [];
        const track = (key: string) => {
          wantedKeys.push(key);
          wantedShapes.add(imgId(key));
        };
        if (src) track("source");
        for (const l of free) track(l.id);
        for (const g of liveGroups) track(`group:${g.id}`);

        const targets = [
          ...free.map((l) => l.id),
          ...liveGroups.map((g) => `group:${g.id}`),
        ];
        if (src) {
          for (const t of targets) {
            wantedShapes.add(arrowId(t));
          }
        }

        // Whitelist: drop every unmanaged shape (orphans, native groups, paste, drop).
        const orphans = editor
          .getCurrentPageShapes()
          .filter((shape) => !wantedShapes.has(shape.id));
        if (orphans.length) editor.deleteShapes(orphans.map((s) => s.id));

        const eSrc = editor.getShape(imgId("source")) as TLImageShape | undefined;
        const upsert = (
          key: string,
          role: "source" | "layer",
          url: string,
          name: string,
          box: { w: number; h: number },
          natural: { w: number; h: number },
          fallback: { x: number; y: number },
          locked: boolean,
          opacity: number,
        ) => {
          const id = imgId(key);
          const assetId = ensureAsset(editor, id, url, name, natural.w, natural.h);
          const prev = editor.getShape(id) as TLImageShape | undefined;
          if (!prev) {
            editor.createShape<TLImageShape>({
              id,
              type: "image",
              x: fallback.x,
              y: fallback.y,
              isLocked: locked,
              opacity,
              props: { w: box.w, h: box.h, assetId },
              meta: { role, layerId: key, name },
            });
          } else {
            const prevMeta = metaOf(prev);
            const needMeta = prevMeta.name !== name || prevMeta.role !== role;
            const needOpacity = (prev.opacity ?? 1) !== opacity;
            const needLock = Boolean(prev.isLocked) !== locked;
            const needAsset = (prev.props as TLImageShape["props"]).assetId !== assetId;
            if (needMeta || needOpacity || needLock || needAsset) {
              editor.updateShape<TLImageShape>({
                id,
                type: "image",
                isLocked: locked,
                opacity,
                props: {
                  assetId,
                  w: prev.props.w || box.w,
                  h: prev.props.h || box.h,
                },
                meta: { role, layerId: key, name },
              });
            }
          }
        };

        // Source: locked, free position (not persisted).
        if (src) {
          upsert(
            "source",
            "source",
            src,
            "原图",
            cardBox(280, 373, 720, 960),
            { w: 720, h: 960 },
            { x: eSrc?.x ?? -520, y: eSrc?.y ?? 40 },
            true,
            1,
          );
        }

        // Rightmost edge of cards we know about, for findPlacement of unplaced items.
        let rightEdge = 0;
        const noteBox = (x: number, w: number) => {
          rightEdge = Math.max(rightEdge, x + w);
        };

        free.forEach((layer) => {
          const box = cardBox(layer.w, layer.h, layer.imgW, layer.imgH);
          const placed = isPlaced(layer.x, layer.y, layer.imgW);
          const x = placed ? (layer.x ?? 0) : rightEdge > 0 ? rightEdge + CARD_GAP : 0;
          const y = placed ? (layer.y ?? 0) : 0;
          if (!placed && !wroteBackRef.current.has(layer.id)) {
            wroteBackRef.current.add(layer.id);
            const patch = { id: layer.id, x, y, w: box.w, h: box.h };
            queueMicrotask(() => {
              lastSavedRef.current = JSON.stringify({
                l: [patch],
                g: [],
              });
              onSaveLayout?.([patch], []);
            });
          }
          noteBox(x, box.w);
          upsert(
            layer.id,
            "layer",
            layer.url,
            layer.name,
            box,
            { w: layer.imgW || 720, h: layer.imgH || 960 },
            { x, y },
            Boolean(layer.locked),
            layer.visible === false ? 0.35 : 1,
          );
        });

        liveGroups.forEach((g) => {
          const members = ordered.filter((l) => l.groupId === g.id);
          if (!members.length) return;
          // Cover = bottom-most member, or the composite preview once 合成 has run.
          // Product: F4 preview lives on the group card — no free-floating composite node.
          const cover = members[0];
          const previewSrc = composite ?? cover.url;
          const box = cardBox(g.w, g.h, g.imgW || cover.imgW, g.imgH || cover.imgH);
          const placed = isPlaced(g.x, g.y, g.imgW || cover.imgW);
          const x = placed ? (g.x ?? 0) : rightEdge > 0 ? rightEdge + CARD_GAP : 0;
          const y = placed ? (g.y ?? 0) : 0;
          if (!placed && !wroteBackRef.current.has(`group:${g.id}`)) {
            wroteBackRef.current.add(`group:${g.id}`);
            const patch = { id: g.id, x, y, w: box.w, h: box.h };
            queueMicrotask(() => {
              lastSavedRef.current = JSON.stringify({ l: [], g: [patch] });
              onSaveLayout?.([], [patch]);
            });
          }
          noteBox(x, box.w);
          upsert(
            `group:${g.id}`,
            "layer",
            previewSrc,
            composite ? `${g.name} · 合成预览` : g.name,
            box,
            { w: g.imgW || cover.imgW || 720, h: g.imgH || cover.imgH || 960 },
            { x, y },
            false,
            1,
          );
        });

        // Arrows: source → free layers + group cards.
        if (src) {
          for (const t of targets) {
            const sImg = editor.getShape(imgId("source")) as TLImageShape | undefined;
            const tImg = editor.getShape(imgId(t)) as TLImageShape | undefined;
            if (!sImg || !tImg) continue;
            const aId = arrowId(t);
            const sx = sImg.x + sImg.props.w;
            const sy = sImg.y + sImg.props.h / 2;
            const ex = tImg.x;
            const ey = tImg.y + tImg.props.h / 2;
            if (!editor.getShape(aId)) {
              editor.createShape<TLArrowShape>({
                id: aId,
                type: "arrow",
                x: sx,
                y: sy,
                isLocked: true,
                props: {
                  kind: "arc",
                  color: "black",
                  dash: "solid",
                  size: "s",
                  arrowheadStart: "none",
                  arrowheadEnd: "arrow",
                  start: { x: 0, y: 0 },
                  end: { x: ex - sx, y: ey - sy },
                  richText: toRichText(""),
                  bend: 0.5,
                },
                meta: { role: "link", layerId: t },
              });
            } else {
              editor.updateShape<TLArrowShape>({
                id: aId,
                type: "arrow",
                isLocked: true,
                props: {
                  ...editor.getShape(aId)!.props,
                  end: { x: ex - sx, y: ey - sy },
                },
                meta: { role: "link", layerId: t },
              });
            }
            for (const b of editor.getBindingsFromShape(aId, "arrow")) {
              editor.deleteBindings([b.id]);
            }
            editor.createBinding({
              type: "arrow",
              fromId: aId,
              toId: imgId("source"),
              props: {
                terminal: "start",
                normalizedAnchor: { x: 1, y: 0.5 },
                isExact: true,
                isPrecise: true,
                snap: "none",
              },
            });
            editor.createBinding({
              type: "arrow",
              fromId: aId,
              toId: imgId(t),
              props: {
                terminal: "end",
                normalizedAnchor: { x: 0, y: 0.5 },
                isExact: true,
                isPrecise: true,
                snap: "none",
              },
            });
          }
        }

        // Drop assets nothing references any more.
        const usedAssets = new Set(
          editor
            .getCurrentPageShapes()
            .map((s) => (s as TLImageShape).props?.assetId)
            .filter(Boolean),
        );
        for (const asset of editor.getAssets()) {
          if (!usedAssets.has(asset.id)) editor.deleteAssets([asset.id]);
        }

        window.setTimeout(() => refreshHubs(), 20);
        if (!didFitRef.current && (src || targets.length)) {
          const restored = restoreCamera(editor);
          didFitRef.current = true;
          if (!restored) editor.zoomToFit({ animation: { duration: 0 } });
        }
      } finally {
        syncingRef.current = false;
      }
    },
    [onSaveLayout, refreshHubs, restoreCamera],
  );

  const refreshSelection = useCallback((editor: Editor) => {
    const ids: string[] = [];
    let gid: string | null = null;
    for (const sid of editor.getSelectedShapeIds()) {
      const meta = metaOf(editor.getShape(sid) ?? {});
      const key = meta.layerId;
      if (!key) continue;
      if (String(key).startsWith("group:")) {
        gid = String(key).slice(6);
        continue;
      }
      if (key === "source" || key === "composite") continue;
      if (!ids.includes(key)) ids.push(key);
      const layer = layersRef.current.find((l) => l.id === key);
      if (layer?.groupId) gid = layer.groupId;
    }
    setSelLayers(ids);
    setSelGroup(gid);
    const shapes = ids.map((id) => editor.getShape(imgId(id))).filter(Boolean) as TLImageShape[];
    const groupCard = gid ? (editor.getShape(imgId(`group:${gid}`)) as TLImageShape | undefined) : null;
    const all = groupCard ? [...shapes, groupCard] : shapes;
    if (all.length) {
      const minX = Math.min(...all.map((s) => s.x));
      const maxX = Math.max(...all.map((s) => s.x + s.props.w));
      const minY = Math.min(...all.map((s) => s.y));
      const p = editor.pageToScreen({ x: (minX + maxX) / 2, y: minY - 12 });
      setToolPos({ x: p.x, y: p.y });
    } else {
      setToolPos(null);
    }
    log.debug("tldraw", "selection", { ids, gid });
  }, []);

  const stackNow = (ids: string[]) => {
    const editor = editorRef.current;
    if (!editor) return;
    const imgs = ids.map((id) => editor.getShape(imgId(id))).filter(Boolean) as TLImageShape[];
    if (imgs.length < 2) return;
    const x0 = Math.min(...imgs.map((s) => s.x));
    const y0 = Math.min(...imgs.map((s) => s.y));
    imgs.forEach((s, i) => {
      editor.updateShape<TLImageShape>({
        id: s.id,
        type: "image",
        x: x0 + i * 16,
        y: y0 + i * 16,
      });
    });
    scheduleLayoutSave();
  };

  const align = (mode: "left" | "centerX" | "right" | "top" | "middleY" | "bottom") => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapes = selLayers
      .map((id) => editor.getShape(imgId(id)))
      .filter(Boolean) as TLImageShape[];
    if (shapes.length < 2) return;
    const minX = Math.min(...shapes.map((s) => s.x));
    const maxX = Math.max(...shapes.map((s) => s.x + s.props.w));
    const minY = Math.min(...shapes.map((s) => s.y));
    const maxY = Math.max(...shapes.map((s) => s.y + s.props.h));
    for (const s of shapes) {
      let x = s.x;
      let y = s.y;
      if (mode === "left") x = minX;
      if (mode === "centerX") x = (minX + maxX) / 2 - s.props.w / 2;
      if (mode === "right") x = maxX - s.props.w;
      if (mode === "top") y = minY;
      if (mode === "middleY") y = (minY + maxY) / 2 - s.props.h / 2;
      if (mode === "bottom") y = maxY - s.props.h;
      editor.updateShape<TLImageShape>({ id: s.id, type: "image", x, y });
    }
    scheduleLayoutSave();
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) syncGraph(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, groups, sourceUrl, compositeUrl]);

  return (
    <div className="canvas-stage" ref={rootRef}>
      <Tldraw
        colorScheme="light"
        overrides={uiOverrides}
        components={{
          Toolbar: () => null,
          StylePanel: () => null,
          PageMenu: () => null,
          NavigationPanel: () => null,
          HelpMenu: () => null,
          ZoomMenu: () => null,
          MainMenu: () => null,
          // Collapse the native image/rich-text toolbars into our single sel-tools bar.
          ImageToolbar: () => null,
          VideoToolbar: () => null,
          RichTextToolbar: () => null,
          // Do NOT override ContextMenu with () => null: in tldraw 5.4.2 the default
          // ContextMenu is what wraps <Canvas />. A null component hides the whole board.
        }}
        onMount={(editor) => {
          editorRef.current = editor;

          // Reject external drops/pastes — whitelist sweep is the only writer.
          const reject = () => {
            /* swallow */
          };
          for (const kind of [
            "files",
            "url",
            "text",
            "svg-text",
            "embed",
            "excalidraw",
            "file-replace",
            "tldraw",
          ] as const) {
            editor.registerExternalContentHandler(kind, reject);
          }

          // Defer first paint-time sync: creating shapes inside onMount can race
          // ShapesLayer's useValue subscription, leaving the store full and the DOM empty.
          const boot = window.setTimeout(() => {
            syncGraph(editor);
            if (!restoreCamera(editor)) {
              editor.zoomToFit({ animation: { duration: 0 } });
            }
          }, 0);

          editor.store.listen(
            () => {
              if (syncingRef.current) return;
              scheduleLayoutSave();
            },
            { source: "user", scope: "document" },
          );

          // Pointer-up is the reliable drag-end signal (store debounce alone missed some drags).
          const onPointerUp = () => {
            if (syncingRef.current) return;
            scheduleLayoutSave();
          };
          editor.getContainer().addEventListener("pointerup", onPointerUp);

          // Names are DOM overlays — follow camera too (throttled).
          let raf = 0;
          const off = editor.store.listen(() => {
            if (raf) return;
            raf = window.requestAnimationFrame(() => {
              raf = 0;
              refreshHubs();
              refreshSelection(editor);
            });
          });
          const onEditorChange = () => {
            if (cameraTimerRef.current != null) window.clearTimeout(cameraTimerRef.current);
            cameraTimerRef.current = window.setTimeout(() => {
              cameraTimerRef.current = null;
              persistCamera();
            }, 300);
          };
          editor.on("change", onEditorChange);

          const root = editor.getContainer();
          const onDbl = (e: MouseEvent) => {
            // Inline rename is owned by the name-stick overlay; never window.prompt.
            e.stopPropagation();
          };
          root.addEventListener("dblclick", onDbl, true);

          const cancelIfBusy = () => {
            const inputs = editor.inputs as unknown as {
              getIsDragging?: () => boolean;
              getIsPointing?: () => boolean;
              isDragging?: boolean;
              isPointing?: boolean;
            };
            const busy =
              inputs.getIsDragging?.() ||
              inputs.getIsPointing?.() ||
              inputs.isDragging ||
              inputs.isPointing;
            if (busy) {
              editor.cancel();
              return true;
            }
            return false;
          };
          const onCtx = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            cancelIfBusy();
          };
          const onDown = (e: PointerEvent) => {
            if (e.button === 2) cancelIfBusy();
          };
          const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") cancelIfBusy();
          };
          root.addEventListener("contextmenu", onCtx, true);
          root.addEventListener("pointerdown", onDown, true);
          window.addEventListener("keydown", onKey);

          return () => {
            window.clearTimeout(boot);
            off();
            editor.getContainer().removeEventListener("pointerup", onPointerUp);
            editor.off("change", onEditorChange);
            root.removeEventListener("dblclick", onDbl, true);
            root.removeEventListener("contextmenu", onCtx, true);
            root.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("keydown", onKey);
            if (raf) window.cancelAnimationFrame(raf);
            if (layoutTimerRef.current != null) window.clearTimeout(layoutTimerRef.current);
            if (cameraTimerRef.current != null) window.clearTimeout(cameraTimerRef.current);
          };
        }}
      />

      <div className="name-layer">
        {names.map((n) =>
          editingId === n.key ? (
            <input
              key={n.key}
              className="name-edit"
              style={{ left: n.x, top: n.y, width: n.w }}
              autoFocus
              defaultValue={n.name}
              onBlur={(e) => commitRename(n, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <div
              key={n.key}
              className="name-stick"
              style={{ left: n.x, top: n.y, width: n.w }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (n.key === "source" || n.key === "composite") return;
                setEditingId(n.key);
              }}
            >
              {n.name}
            </div>
          ),
        )}
      </div>
      <div className="junction-layer">
        {hubs.map((t) => (
          <button
            key={t.key}
            type="button"
            className="junction-dot"
            style={{ left: t.x, top: t.y }}
            title="解组"
            onClick={() => onUngroup(t.groupId)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="2" y="2" width="5" height="5" stroke="currentColor" fill="none" />
              <rect x="9" y="2" width="5" height="5" stroke="currentColor" fill="none" />
              <rect x="2" y="9" width="5" height="5" stroke="currentColor" fill="none" />
              <rect x="9" y="9" width="5" height="5" stroke="currentColor" fill="none" />
            </svg>
          </button>
        ))}
      </div>

      {(selLayers.length > 0 || selGroup) && toolPos && (
        <div
          className="sel-tools"
          style={{ left: toolPos.x, top: toolPos.y, transform: "translate(-50%, -100%)" }}
        >
          {selLayers.length === 1 && !selGroup && (
            <>
              <button type="button" title="层序↑" onClick={() => onMoveOrder(selLayers[0], "up")}>
                ↑
              </button>
              <button type="button" title="层序↓" onClick={() => onMoveOrder(selLayers[0], "down")}>
                ↓
              </button>
              <button
                type="button"
                title="显示/隐藏"
                onClick={() => {
                  const layer = layersRef.current.find((l) => l.id === selLayers[0]);
                  if (!layer) return;
                  onSetFlags?.(layer.id, { visible: layer.visible === false });
                }}
              >
                {layersRef.current.find((l) => l.id === selLayers[0])?.visible === false ? "○" : "●"}
              </button>
              <button
                type="button"
                title="锁定/解锁"
                onClick={() => {
                  const layer = layersRef.current.find((l) => l.id === selLayers[0]);
                  if (!layer) return;
                  onSetFlags?.(layer.id, { locked: !layer.locked });
                }}
              >
                {layersRef.current.find((l) => l.id === selLayers[0])?.locked ? "🔒" : "🔓"}
              </button>
              <button
                type="button"
                title="删除此层"
                onClick={() => {
                  const id = selLayers[0];
                  if (id) onDeleteLayer?.(id);
                }}
              >
                ✕
              </button>
            </>
          )}
          {selLayers.length >= 2 && (
            <>
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
              <button
                type="button"
                className="primary icon-btn"
                title="打组"
                onClick={() => {
                  stackNow(selLayers);
                  onGroup(selLayers);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <rect x="2" y="6" width="9" height="7" rx="1.2" stroke="currentColor" fill="none" />
                  <rect x="4" y="3.5" width="9" height="7" rx="1.2" stroke="currentColor" fill="#fff" />
                  <rect x="6" y="1.5" width="8" height="7" rx="1.2" stroke="currentColor" fill="#fff" />
                </svg>
              </button>
            </>
          )}
          {selGroup && (
            <button
              type="button"
              className="primary icon-btn"
              title="解组"
              onClick={() => onUngroup(selGroup)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                <rect x="2" y="2" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="9" y="2" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="2" y="9" width="5" height="5" stroke="currentColor" fill="none" />
                <rect x="9" y="9" width="5" height="5" stroke="currentColor" fill="none" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default CanvasStage;
