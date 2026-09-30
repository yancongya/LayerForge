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

export type CanvasApi = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  selectLayer: (id: string) => void;
};

type Props = {
  layers: Layer[];
  groups: LayerGroup[];
  sourceUrl?: string | null;
  onGroup: (memberIds: string[]) => void;
  onUngroup: (groupId: string) => void;
  onToggleCollapse: (groupId: string, collapsed: boolean) => void;
  onMoveOrder: (layerId: string, dir: "up" | "down") => void;
  onRename?: (layerId: string, name: string) => void;
  onRenameGroup?: (groupId: string, name: string) => void;
};

const uiOverrides: TLUiOverrides = {
  tools(_editor: Editor, tools: TLUiToolsContextType) {
    const keep = new Set(["select", "hand", "zoom"]);
    for (const key of Object.keys(tools)) {
      if (!keep.has(key)) delete tools[key as keyof TLUiToolsContextType];
    }
    return tools;
  },
};

const NODE_W = 280;
const NODE_H = 373;

function metaOf(shape: { meta?: unknown }): { role?: string; layerId?: string } {
  return (shape.meta as { role?: string; layerId?: string }) ?? {};
}
function imgId(id: string): TLShapeId {
  return createShapeId(`lf-${id}`);
}
function nameId(id: string): TLShapeId {
  return createShapeId(`lf-n-${id}`);
}
function arrowId(id: string): TLShapeId {
  return createShapeId(`lf-a-${id}`);
}

function ensureAsset(editor: Editor, key: string, url: string, name: string) {
  const assetId = AssetRecordType.createId(key);
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          src: url,
          w: 720,
          h: 960,
          name,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: { layerId: key },
      },
    ]);
  }
  return assetId;
}

/** Name under image, locked, snapped on every sync (no groupShapes — it desynced coords). */
/* names rendered as React overlay under each image (always glued on screen) */

type Hub = { key: string; x: number; y: number; groupId: string };
type NameLabel = { key: string; name: string; x: number; y: number; w: number };

const CanvasStage = forwardRef<CanvasApi, Props>(function CanvasStage(
  {
    layers,
    groups,
    sourceUrl,
    onGroup,
    onUngroup,
    onToggleCollapse,
    onMoveOrder,
    onRename,
    onRenameGroup,
  },
  ref,
) {
  void onToggleCollapse;
  const editorRef = useRef<Editor | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef(layers);
  const groupsRef = useRef(groups);
  const sourceRef = useRef(sourceUrl);
  const didFitRef = useRef(false);
  const [selLayers, setSelLayers] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [names, setNames] = useState<NameLabel[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const commitRename = (n: NameLabel, value: string) => {
    setEditingId(null);
    const name = value.trim();
    if (!name || n.key === "source") return;
    if (String(n.key).startsWith("group:")) onRenameGroup?.(String(n.key).slice(6), name);
    else onRename?.(n.key, name);
  };
  const [toolPos, setToolPos] = useState<{ x: number; y: number } | null>(null);

  layersRef.current = layers;
  groupsRef.current = groups;
  sourceRef.current = sourceUrl;

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
      pin(`group:${g.id}`, g.name);
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

  /**
   * Free layers: image + name below, arrow from source.
   * Group: ONE card (cover image + group name), ONE arrow from source.
   * Members stay in layers.json but are hidden on canvas while grouped.
   */
  const syncGraph = useCallback(
    (editor: Editor) => {
      const ordered = [...layersRef.current].sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      );
      const src = sourceRef.current;
      const groupedIds = new Set(ordered.filter((l) => l.groupId).map((l) => l.id));
      const free = ordered.filter((l) => !l.groupId);

      const wanted = new Set<string>(["source"]);
      for (const l of free) wanted.add(l.id);
      for (const g of groupsRef.current) {
        if (ordered.some((l) => l.groupId === g.id)) wanted.add(`group:${g.id}`);
      }

      // delete stale nodes (hidden members + old cards/labels/arrows)
      for (const shape of editor.getCurrentPageShapes()) {
        const meta = metaOf(shape);
        const t = shape.type;
        if (t !== "image" && t !== "text" && t !== "arrow") continue;
        const key = meta.layerId;
        const ours =
          meta.role === "source" ||
          meta.role === "layer" ||
          meta.role === "link" ||
          meta.role === "label" ||
          key === "source" ||
          String(key ?? "").startsWith("group:") ||
          (key && groupedIds.has(key));
        if (!ours) continue;
        const normalized =
          key && groupedIds.has(key) && !String(key).startsWith("group:")
            ? key
            : key;
        if (!wanted.has(normalized ?? "")) editor.deleteShapes([shape.id]);
      }

      // hide any leftover member images
      for (const id of groupedIds) {
        editor.deleteShapes([imgId(id), nameId(id), arrowId(id)]);
      }

      const eSrc = editor.getShape(imgId("source")) as TLImageShape | undefined;
      const upsert = (
        key: string,
        role: "source" | "layer",
        url: string,
        name: string,
        x: number,
        y: number,
        forcePos: boolean,
      ) => {
        const id = imgId(key);
        const assetId = ensureAsset(editor, id, url, name);
        const prev = editor.getShape(id) as TLImageShape | undefined;
        const fx = forcePos ? x : (prev?.x ?? x);
        const fy = forcePos ? y : (prev?.y ?? y);
        if (!prev) {
          editor.createShape<TLImageShape>({
            id,
            type: "image",
            x: fx,
            y: fy,
            props: { w: NODE_W, h: NODE_H, assetId },
            meta: { role, layerId: key, name },
          });
        } else {
          editor.updateShape<TLImageShape>({
            id,
            type: "image",
            x: fx,
            y: fy,
            props: { assetId },
            meta: { role, layerId: key, name },
          });
        }
        };

      if (src) {
        upsert("source", "source", src, "原图", eSrc?.x ?? -520, eSrc?.y ?? 40, false);
      }

      // free layers by order
      free.forEach((layer, i) => {
        upsert(layer.id, "layer", layer.url, layer.name, 80, i * (NODE_H + 90), true);
      });

      // group cards: one node per group, name = group name
      groupsRef.current.forEach((g, gi) => {
        const members = ordered.filter((l) => l.groupId === g.id);
        if (!members.length) return;
        const cover = members[0].url;
        const y = (free.length + gi) * (NODE_H + 90);
        upsert(`group:${g.id}`, "layer", cover, g.name, 80, y, true);
      });

      // arrows: source → free layers + source → group cards (one line per child)
      const targets: Array<{ id: string }> = [
        ...free.map((l) => ({ id: l.id })),
        ...groupsRef.current
          .filter((g) => ordered.some((l) => l.groupId === g.id))
          .map((g) => ({ id: `group:${g.id}` })),
      ];
      if (src) {
        for (const t of targets) {
          const sImg = editor.getShape(imgId("source")) as TLImageShape | undefined;
          const tImg = editor.getShape(imgId(t.id)) as TLImageShape | undefined;
          if (!sImg || !tImg) continue;
          const aId = arrowId(t.id);
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
              meta: { role: "link", layerId: t.id },
            });
          } else {
            editor.updateShape<TLArrowShape>({
              id: aId,
              type: "arrow",
              isLocked: true,
              meta: { role: "link", layerId: t.id },
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
            toId: imgId(t.id),
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

      window.setTimeout(() => refreshHubs(), 20);
      if (!didFitRef.current && (src || targets.length)) {
        didFitRef.current = true;
        editor.zoomToFit({ animation: { duration: 0 } });
      }
    },
    [refreshHubs],
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
      if (key === "source") continue;
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
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) syncGraph(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, groups, sourceUrl]);

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
        }}
        onMount={(editor) => {
          editorRef.current = editor;
          syncGraph(editor);
          editor.store.listen(() => {
            refreshHubs();
            refreshSelection(editor);
          });

          const root = editor.getContainer();
          const onDbl = () => {
            const target = editor.getSelectedShapes()[0];
            if (!target) return;
            const key = metaOf(target).layerId;
            if (!key || key === "source") return;
            if (String(key).startsWith("group:")) {
              const gid = String(key).slice(6);
              const g = groupsRef.current.find((x) => x.id === gid);
              if (!g) return;
              const next = window.prompt("组名称", g.name);
              if (next == null || !next.trim()) return;
              onRenameGroup?.(gid, next.trim());
              return;
            }
            const layer = layersRef.current.find((l) => l.id === key);
            if (!layer) return;
            const next = window.prompt("图层名称", layer.name);
            if (next == null || !next.trim()) return;
            onRename?.(layer.id, next.trim());
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
            if (cancelIfBusy()) {
              e.preventDefault();
              e.stopPropagation();
            }
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
