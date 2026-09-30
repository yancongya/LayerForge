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
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const onGroup = async (memberIds: string[]) => {
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
    try {
      const data = await renameLayer(project.id, id, name);
      applyProject(data);
      setStatus({ kind: "ok", text: `已改名 ${name}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onRenameGroup = async (gid: string, name: string) => {
    try {
      const data = await renameGroup(project.id, gid, name);
      applyProject(data);
      setStatus({ kind: "ok", text: `组已改名 ${name}` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  };

  const onDelete = async (id: string) => {
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

  const onSetFlags = async (id: string, flags: { visible?: boolean; locked?: boolean }) => {
    try {
      const data = await setLayerFlags(project.id, id, flags);
      applyProject(data);
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
            onRename={(id, name) => void onRename(id, name)}
            onRenameGroup={(gid, name) => void onRenameGroup(gid, name)}
            onDeleteLayer={(id) => void onDelete(id)}
            onSetFlags={(id, flags) => void onSetFlags(id, flags)}
            onSaveLayout={(ls, gs) => void onSaveLayout(ls, gs)}
          />
        </div>

        <div className="zoom-tools">
          <button type="button" title="缩小" onClick={() => canvasApi.current?.zoomOut()}>
            −
          </button>
          <button type="button" title="适配" onClick={() => canvasApi.current?.fit()}>
            ⤢
          </button>
          <button type="button" title="放大" onClick={() => canvasApi.current?.zoomIn()}>
            +
          </button>
        </div>

        {!layers.length && (
          <div className="canvas-hint">
            <strong>导入原图开始</strong>
            <div>拖入 / 粘贴图片，或点「导入」</div>
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
