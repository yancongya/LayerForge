import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composeProject,
  decomposeProject,
  deleteLayer,
  exportProject,
  fileToDataUrl,
  getProject,
  groupLayers,
  listProjects,
  renameGroup,
  renameLayer,
  reorderLayers,
  replaceDocument,
  saveLayout,
  setLayerFlags,
  ungroupLayers,
  type LayoutPatch,
} from "./api";
import CanvasStage, { type CanvasApi, type LayoutItem } from "./CanvasStage";
import DebugPanel from "./DebugPanel";
import { log } from "./log";
import type { Layer, ProjectPayload, ViewMode } from "./types";

type Status = { kind: "ok" | "err" | "info"; text: string };

/** Placeholder until the API answers. No layers ⇒ canvas does not invent geometry. */
const EMPTY_PROJECT: ProjectPayload = {
  id: "demo",
  rev: 0,
  root: "projects/demo",
  layers: [],
  groups: [],
  sourceUrl: null,
  compositeUrl: null,
};

export default function App() {
  const [view, setView] = useState<ViewMode>("canvas");
  const [projectId, setProjectId] = useState("demo");
  const [project, setProject] = useState<ProjectPayload>(EMPTY_PROJECT);
  const [status, setStatus] = useState<Status>({
    kind: "info",
    text: "导入原图 → 拆层 → 选中对齐/打组 → 合成",
  });
  const [busy, setBusy] = useState(false);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [showHelp, setShowHelp] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const dragLayerId = useRef<string | null>(null);
  const undoStack = useRef<ProjectPayload[]>([]);
  const redoStack = useRef<ProjectPayload[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const liveComposeTimer = useRef<number | null>(null);

  /** E4: debounced recompose after layer mutations so group preview stays live. */
  const draftKey = `lf:draft:${projectId}`;
  const [draftDataUrl, setDraftDataUrl] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`lf:draft:${projectId}`);
      if (raw) setDraftDataUrl(raw);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setDraftDataUrl(null);
  };

  const scheduleLiveCompose = useCallback(() => {
    if (!apiOk) return;
    if (liveComposeTimer.current != null) window.clearTimeout(liveComposeTimer.current);
    liveComposeTimer.current = window.setTimeout(async () => {
      liveComposeTimer.current = null;
      try {
        const data = await composeProject(projectRef.current.id);
        applyProject(data);
      } catch (err) {
        log.warn("app", "live compose failed", String(err));
      }
    }, 400);
  }, [apiOk]);

  /** Snapshot current layers.json state before a mutation (undo unit). */
  const pushUndo = useCallback(() => {
    undoStack.current.push(projectRef.current);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const restoreSnapshot = async (snap: ProjectPayload) => {
    const data = await replaceDocument(snap.id, snap.layers ?? [], snap.groups ?? []);
    applyProject(data);
  };

  const onUndo = async () => {
    const prev = undoStack.current.pop();
    if (!prev) {
      setStatus({ kind: "info", text: "没有可撤销的操作" });
      return;
    }
    redoStack.current.push(projectRef.current);
    try {
      await restoreSnapshot(prev);
      setStatus({ kind: "ok", text: "已撤销" });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onRedo = async () => {
    const next = redoStack.current.pop();
    if (!next) {
      setStatus({ kind: "info", text: "没有可重做的操作" });
      return;
    }
    undoStack.current.push(projectRef.current);
    try {
      await restoreSnapshot(next);
      setStatus({ kind: "ok", text: "已重做" });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasApi = useRef<CanvasApi>(null);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      if (!data.projects?.length) {
        setApiOk(false);
        return;
      }
      setApiOk(true);
      setProjectId((prev) =>
        data.projects.find((p) => p.id === prev)?.id ?? data.projects[0].id,
      );
    } catch {
      setApiOk(false);
      setStatus({ kind: "err", text: "API 不可用（npm run dev）" });
    }
  }, []);

  const loadProject = useCallback(async (id: string) => {
    try {
      const data = await getProject(id);
      setProject(data);
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (apiOk) void loadProject(projectId);
  }, [projectId, apiOk, loadProject]);

  const layers: Layer[] = useMemo(
    () =>
      [...(project?.layers ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    [project],
  );

  const applyProject = (next: ProjectPayload) => {
    log.info("app", "applyProject", {
      rev: next.rev,
      layers: next.layers.map((l) => `${l.id}/g=${l.groupId}/o=${l.order}`),
      groups: (next.groups || []).map((g) => `${g.id}/c=${g.collapsed}/${g.memberIds.join("+")}`),
    });
    setProject(next);
  };

  const acceptFile = useCallback(async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const dataUrl = await fileToDataUrl(file);
    setPendingDataUrl(dataUrl);
    setProject((p) => ({ ...p, sourceUrl: dataUrl }));
    try {
      localStorage.setItem(`lf:draft:${projectId}`, dataUrl);
      setDraftDataUrl(dataUrl);
    } catch {
      /* quota */
    }
    setStatus({ kind: "ok", text: `已导入 ${file.name}` });
  }, []);

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      void acceptFile(e.dataTransfer?.files?.[0]);
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f) void acceptFile(f);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [acceptFile]);

  // Ctrl+wheel over UI chrome must not browser-zoom the page; canvas zoom stays in tldraw.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_") {
        e.preventDefault();
      }
      // Ctrl+0 / Cmd+0 → 100% (do not browser-zoom)
      if (e.key === "0") {
        e.preventDefault();
        canvasApi.current?.zoomTo100();
      }
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        void (e.shiftKey ? onRedo() : onUndo());
      }
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        void onRedo();
      }
    };
    // passive:false is required for preventDefault on wheel; capture wins over UI handlers.
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  const onDecompose = async () => {
    if (!apiOk) return;
    setBusy(true);
    try {
      const data = await decomposeProject(project.id, {
        dataUrl: pendingDataUrl ?? undefined,
        layers: 3,
      });
      applyProject(data);
      setPendingDataUrl(null);
      setStatus({ kind: "ok", text: `已拆出 ${data.layers.length} 层` });
      setTimeout(() => canvasApi.current?.fit(), 60);
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onMove = async (id: string, dir: "up" | "down") => {
    pushUndo();
    const ids = layers.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = ids.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setBusy(true);
    try {
      const data = await reorderLayers(project.id, next);
      applyProject(data);
      setStatus({ kind: "ok", text: `顺序 ${next.join("→")}` });
      scheduleLiveCompose();
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  /** Reverse the selected layers' relative order; others stay put. */
  const onReverseOrder = async (selected: string[]) => {
    pushUndo();
    const ids = layers.map((l) => l.id);
    const selectedSet = new Set(selected);
    const picked = ids.filter((id) => selectedSet.has(id));
    if (picked.length < 2) return;
    const reversed = picked.slice().reverse();
    let k = 0;
    const next = ids.map((id) => (selectedSet.has(id) ? reversed[k++] : id));
    setBusy(true);
    try {
      const data = await reorderLayers(project.id, next);
      applyProject(data);
      setStatus({ kind: "ok", text: `已倒序 ${reversed.join("→")}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onGroup = async (memberIds: string[]) => {
    pushUndo();
    log.info("app", "onGroup click", { memberIds });
    setBusy(true);
    try {
      const data = await groupLayers(project.id, memberIds);
      applyProject(data);
      setStatus({ kind: "ok", text: `已打组（${memberIds.length} 层）` });
    } catch (err) {
      log.error("app", "onGroup failed", String(err));
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onUngroup = async (groupId: string) => {
    pushUndo();
    setBusy(true);
    try {
      const data = await ungroupLayers(project.id, groupId);
      applyProject(data);
      setStatus({ kind: "ok", text: "已解组" });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onRename = async (id: string, name: string) => {
    pushUndo();
    try {
      const data = await renameLayer(project.id, id, name);
      applyProject(data);
      setStatus({ kind: "ok", text: `已改名 ${name}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onRenameGroup = async (gid: string, name: string) => {
    pushUndo();
    try {
      const data = await renameGroup(project.id, gid, name);
      applyProject(data);
      setStatus({ kind: "ok", text: `组已改名 ${name}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onDelete = async (id: string) => {
    pushUndo();
    setBusy(true);
    try {
      const data = await deleteLayer(project.id, id);
      applyProject(data);
      setStatus({ kind: "ok", text: "已删除一层" });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onSetFlags = async (
    id: string,
    flags: { visible?: boolean; locked?: boolean; opacity?: number },
  ) => {
    pushUndo();
    try {
      const data = await setLayerFlags(project.id, id, flags);
      applyProject(data);
      scheduleLiveCompose();
      setStatus({
        kind: "ok",
        text: flags.visible === false ? "已隐藏（不进合成）" : flags.visible === true ? "已显示" : flags.locked ? "已锁定" : "已解锁",
      });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onSaveLayout = useCallback(async (items: LayoutItem[], groupItems: LayoutItem[]) => {
    const toPatch = (list: LayoutItem[]): LayoutPatch[] =>
      list.map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }));
    try {
      const data = await saveLayout(project.id, toPatch(items), toPatch(groupItems));
      // Quiet apply — do not spam status on every drag-end.
      applyProject(data);
    } catch (err) {
      log.error("app", "saveLayout failed", String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const onCompose = async () => {
    if (!apiOk) return;
    setBusy(true);
    try {
      const data = await composeProject(project.id);
      applyProject(data);
      setStatus({
        kind: "ok",
        text: `已合成 → 组节点预览更新（${data.output || "composite.png"}）`,
      });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    if (!apiOk) return;
    setBusy(true);
    try {
      const data = await exportProject(project.id);
      setStatus({ kind: "ok", text: `导出 ${data.files.length} 个文件` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden />
          <span>LayerForge</span>
        </div>
        <div className="seg">
          <button
            type="button"
            className={view === "canvas" ? "on" : ""}
            onClick={() => setView("canvas")}
            title="对齐 / 打组 / 拖动都在这里"
          >
            画布
          </button>
          <button
            type="button"
            className={view === "groups" ? "on" : ""}
            onClick={() => {
              setView("groups");
              if (apiOk) void loadProject(projectId);
            }}
            title="查看原图→组→图层映射"
          >
            组映射
          </button>
        </div>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void acceptFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn primary" onClick={onDecompose} disabled={busy}>
          {busy ? "…" : "拆层"}
        </button>
        <button type="button" className="btn" onClick={onCompose} disabled={busy || !layers.length}>
          合成
        </button>
        <button type="button" className="btn" onClick={onExport} disabled={busy || !layers.length}>
          导出
        </button>
        <div className="pill">
          <i />
          {project?.root ?? "—"}
        </div>
      </header>

      <main
        className={`main ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void acceptFile(e.dataTransfer?.files?.[0]);
        }}
      >
        <div className="canvas-wrap">
          <CanvasStage
            ref={canvasApi}
            projectId={project?.id ?? projectId}
            layers={layers}
            groups={project?.groups ?? []}
            sourceUrl={project?.sourceUrl ?? pendingDataUrl}
            compositeUrl={project?.compositeUrl ?? null}
            onGroup={(ids) => void onGroup(ids)}
            onUngroup={(gid) => void onUngroup(gid)}
            onMoveOrder={(id, dir) => void onMove(id, dir)}
            onReverseOrder={(ids) => void onReverseOrder(ids)}
            onRename={(id, name) => void onRename(id, name)}
            onRenameGroup={(gid, name) => void onRenameGroup(gid, name)}
            onDeleteLayer={(id) => void onDelete(id)}
            onSetFlags={(id, flags) => void onSetFlags(id, flags)}
            onSaveLayout={(ls, gs) => void onSaveLayout(ls, gs)}
            onZoom={(z) => setZoomPct(Math.round(z * 100))}
            showMinimap={showMinimap}
          />
        </div>

        <div className="zoom-tools">
          <button type="button" title="缩小" onClick={() => canvasApi.current?.zoomOut()}>
            −
          </button>
          <button
            type="button"
            title="100%"
            className="zoom-pct"
            onClick={() => canvasApi.current?.zoomTo100()}
          >
            {zoomPct}%
          </button>
          <button type="button" title="适配" onClick={() => canvasApi.current?.fit()}>
            ⤢
          </button>
          <button type="button" title="放大" onClick={() => canvasApi.current?.zoomIn()}>
            +
          </button>
          <button type="button" title="撤销 (Ctrl+Z)" onClick={() => void onUndo()}>
            ↶
          </button>
          <button type="button" title="重做 (Ctrl+Shift+Z)" onClick={() => void onRedo()}>
            ↷
          </button>
          <button
            type="button"
            title="快捷键"
            onClick={() => setShowHelp((v) => !v)}
          >
            ?
          </button>
          <button
            type="button"
            title="缩略图"
            className={showMinimap ? "on" : ""}
            onClick={() => setShowMinimap((v) => !v)}
          >
            ◫
          </button>
        </div>

        {showHelp && (
          <div className="help-panel">
            <div className="help-head">
              <strong>快捷键</strong>
              <button type="button" onClick={() => setShowHelp(false)}>
                ✕
              </button>
            </div>
            <ul>
              <li><kbd>双击名字</kbd> 改名</li>
              <li><kbd>双击组卡</kbd> 进入组内 · <kbd>Esc</kbd> 退出</li>
              <li><kbd>↑↓←→</kbd> 微调选中（<kbd>Shift</kbd> ×10）</li>
              <li><kbd>Ctrl+0</kbd> 100% · <kbd>Ctrl+滚轮</kbd> 画布缩放</li>
              <li><kbd>Ctrl+A</kbd> 全选 · 多选工具条：倒序 / 排布 / 对齐 / 打组</li>
              <li><kbd>解组点</kbd>（组卡左侧）解组</li>
            </ul>
          </div>
        )}

        {!layers.length && (
          <div className="canvas-hint">
            <strong>导入原图开始</strong>
            <div>拖入 / 粘贴图片，或点「导入」</div>
          </div>
        )}

        {draftDataUrl && !pendingDataUrl && (
          <div className="draft-banner">
            <span>发现未拆层的草稿原图</span>
            <button
              type="button"
              onClick={() => {
                setPendingDataUrl(draftDataUrl);
                setProject((p) => ({ ...p, sourceUrl: draftDataUrl }));
                setStatus({ kind: "ok", text: "已恢复草稿，可点「拆层」" });
                clearDraft();
              }}
            >
              恢复
            </button>
            <button type="button" onClick={clearDraft}>
              丢弃
            </button>
          </div>
        )}

        {dragOver && (
          <div className="drop-veil">
            <div>松开导入图片</div>
          </div>
        )}

        {view === "groups" && (
          <aside className="groups mapping">
            <div className="groups-head">
              <h2>组 · 映射关系</h2>
              <span>
                {project?.sourceUrl ? "原图" : "—"} → {layers.length} 层 /{" "}
                {(project?.groups ?? []).length} 组
              </span>
            </div>
            <div className="layer-list tree map-tree">
              <div className="map-root">
                <div className="map-node source-node">
                  <div
                    className="thumb"
                    style={{
                      backgroundImage: project?.sourceUrl
                        ? `url(${project.sourceUrl})`
                        : undefined,
                    }}
                  />
                  <div>
                    <div className="layer-name">原图 source</div>
                    <div className="layer-meta">{project?.root}/source.png</div>
                  </div>
                </div>
              </div>

              <div className="map-branch">
                {(project?.groups ?? []).map((g) => {
                  const members = layers.filter((l) => l.groupId === g.id);
                  return (
                    <div key={g.id} className="map-group-block">
                      <div
                        className="map-node group-node clickable"
                        onClick={() => canvasApi.current?.selectLayer(`group:${g.id}`)}
                      >
                        <span className="map-tag">组</span>
                        <div>
                          <div className="layer-name">{g.name}</div>
                          <div className="layer-meta">
                            {g.id} · order={g.order} · {members.length} 成员
                          </div>
                        </div>
                      </div>
                      <div className="map-children">
                        {members.map((m) => (
                          <div
                            key={m.id}
                            className="map-node child-node clickable"
                            draggable
                            onDragStart={() => {
                              dragLayerId.current = m.id;
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const from = dragLayerId.current;
                              if (!from || from === m.id) return;
                              const ids = layers.map((l) => l.id);
                              const fi = ids.indexOf(from);
                              const ti = ids.indexOf(m.id);
                              if (fi < 0 || ti < 0) return;
                              const next = ids.slice();
                              next.splice(fi, 1);
                              next.splice(ti, 0, from);
                              dragLayerId.current = null;
                              void (async () => {
                                setBusy(true);
                                try {
                                  const data = await reorderLayers(project.id, next);
                                  applyProject(data);
                                  setStatus({ kind: "ok", text: "已调序" });
                                } catch (err) {
                                  setStatus({
                                    kind: "err",
                                    text: err instanceof Error ? err.message : String(err),
                                  });
                                } finally {
                                  setBusy(false);
                                }
                              })();
                            }}
                            onClick={() => canvasApi.current?.selectLayer(m.id)}
                          >
                            <div
                              className="thumb"
                              style={{ backgroundImage: `url(${m.url})` }}
                            />
                            <div>
                              <div className="layer-name">{m.name}</div>
                              <div className="layer-meta">
                                {m.id} · order={m.order}
                                {m.visible === false ? " · 隐藏" : ""}
                                {m.locked ? " · 锁定" : ""}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {layers
                  .filter((l) => !l.groupId)
                  .map((layer) => (
                    <div
                      key={layer.id}
                      className="map-node layer-node clickable"
                      draggable
                      onDragStart={() => {
                        dragLayerId.current = layer.id;
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragLayerId.current;
                        if (!from || from === layer.id) return;
                        const ids = layers.map((l) => l.id);
                        const fi = ids.indexOf(from);
                        const ti = ids.indexOf(layer.id);
                        if (fi < 0 || ti < 0) return;
                        const next = ids.slice();
                        next.splice(fi, 1);
                        next.splice(ti, 0, from);
                        dragLayerId.current = null;
                        void (async () => {
                          setBusy(true);
                          try {
                            const data = await reorderLayers(project.id, next);
                            applyProject(data);
                            setStatus({ kind: "ok", text: "已调序" });
                          } catch (err) {
                            setStatus({
                              kind: "err",
                              text: err instanceof Error ? err.message : String(err),
                            });
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                      onClick={() => canvasApi.current?.selectLayer(layer.id)}
                    >
                      <div className="thumb" style={{ backgroundImage: `url(${layer.url})` }} />
                      <div>
                        <div className="layer-name">{layer.name}</div>
                        <div className="layer-meta">
                          {layer.id} · order={layer.order} · 独立层
                          {layer.visible === false ? " · 隐藏" : ""}
                          {layer.locked ? " · 锁定" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="groups-foot">
              映射：原图 → 组 → 图层（与 layers.json 一致）
              <br />
              位置影响排版，不影响合成输出（见 layers.json 注释）
            </div>
          </aside>
        )}

        <div className={`status ${status.kind}`}>
          {apiOk === false && (
            <strong className="api-down">API 未连接 — 请用 npm run dev 打开 http://127.0.0.1:5173（静态页无法写盘/打组）</strong>
          )}
          {status.text}
        </div>
        <DebugPanel />
      </main>
    </div>
  );
}
