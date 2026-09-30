/**
 * LayerForge local API plugin for Vite.
 * Filesystem is the source of truth: projects/<id>/layers.json + layer PNGs.
 * Mutations shell out to packages/layer-core (Python) so order/compose/export
 * are persisted, not just held in browser memory.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const PROJECTS_ROOT = path.join(REPO_ROOT, "projects");
const LAYER_CORE = path.join(REPO_ROOT, "packages", "layer-core");
const PYTHON = process.env.MIMO_PYTHON || process.env.PYTHON || "python";

type Layer = {
  id: string;
  name: string;
  file: string;
  order: number;
  groupId?: string | null;
  /** Canvas layout only — never read by compose. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Natural PNG size, measured by layer-core when absent. */
  imgW?: number;
  imgH?: number;
  visible?: boolean;
  locked?: boolean;
};
type Group = {
  id: string;
  name: string;
  order: number;
  memberIds: string[];
  collapsed?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  imgW?: number;
  imgH?: number;
};

function projectDir(id: string) {
  if (!/^[\w.-]+$/.test(id)) {
    throw new Error("invalid project id");
  }
  const dir = path.join(PROJECTS_ROOT, id);
  if (!dir.startsWith(PROJECTS_ROOT)) throw new Error("invalid project path");
  return dir;
}

function readDocument(projectId: string): { layers: Layer[]; groups: Group[]; rev: number } {
  const file = path.join(projectDir(projectId), "layers.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    layers: Layer[];
    groups?: Group[];
    rev?: number;
  };
  const layers = [...raw.layers]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((l) => ({ ...l, groupId: l.groupId ?? null }));
  const groups = [...(raw.groups || [])]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((g) => ({ ...g, collapsed: Boolean(g.collapsed) }));
  return { layers, groups, rev: Number(raw.rev) || 0 };
}

function readLayers(projectId: string): Layer[] {
  return readDocument(projectId).layers;
}

function runLayerCore(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-m", "layer_core.cli", ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: [LAYER_CORE, process.env.PYTHONPATH || ""].filter(Boolean).join(path.delimiter),
      },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr: stderr || "layer-core timed out" });
    }, 20_000);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logLine("layer-core", `exit ${code}`, {
        args: args.join(" "),
        ok: code === 0,
        stderr: stderr.slice(0, 400),
      });
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(err) });
    });
  });
}

function json(res: import("http").ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function listProjectIds(): string[] {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PROJECTS_ROOT, d.name, "layers.json")))
    .map((d) => d.name);
}

const LOG_DIR = path.join(REPO_ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "layerforge.log");

function appendLog(line: string) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {
    /* ignore disk errors */
  }
}

function logLine(tag: string, msg: string, data?: unknown) {
  const t = new Date().toISOString();
  const extra = data === undefined ? "" : " " + JSON.stringify(data);
  appendLog(`${t} INFO ${tag}: ${msg}${extra}`);
}

function projectPayload(id: string) {
  const dir = projectDir(id);
  const doc = readDocument(id);
  const layers = doc.layers.map((layer) => ({
    ...layer,
    // `?v=<rev>` busts the browser cache when a re-decompose rewrites the same
    // filename (fixes F5) while still letting unchanged PNGs hit the cache.
    url: `/projects/${id}/${layer.file.replace(/\\/g, "/")}?v=${doc.rev}`,
  }));
  const compositeFile = path.join(dir, "composite.png");
  const sourceFile = ["source.png", "source.jpg", "source.jpeg", "source.webp"]
    .map((name) => path.join(dir, name))
    .find((p) => fs.existsSync(p));
  return {
    id,
    rev: doc.rev,
    root: path.relative(REPO_ROOT, dir).replace(/\\/g, "/"),
    layers,
    groups: doc.groups,
    sourceUrl: sourceFile
      ? `/projects/${id}/${path.basename(sourceFile)}?ts=${Date.now()}`
      : null,
    compositeUrl: fs.existsSync(compositeFile) ? `/projects/${id}/composite.png?ts=${Date.now()}` : null,
  };
}

export function layerforgeApi(): Plugin {
  return {
    name: "layerforge-api",
    configureServer(server) {
      // Mounted at /projects — req.url is the remainder after the mount point.
      server.middlewares.use("/projects", (req, res, next) => {
        const url = (req.url || "/").split("?")[0];
        const rel = decodeURIComponent(url).replace(/^\/+/, "");
        const abs = path.join(PROJECTS_ROOT, rel);
        if (!abs.startsWith(PROJECTS_ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          next();
          return;
        }
        const ext = path.extname(abs).toLowerCase();
        const types: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".json": "application/json",
          ".webp": "image/webp",
        };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        fs.createReadStream(abs).pipe(res);
      });

      // Mounted at /api — req.url is e.g. `/projects/demo` not `/api/projects/demo`.
      server.middlewares.use("/api", async (req, res) => {
        const url = (req.url || "/").split("?")[0];
        const method = req.method || "GET";
        try {
          // --- debug logging ---
          if (method === "GET" && (url === "/log" || url === "/logs")) {
            let text = "";
            try {
              text = fs.existsSync(LOG_FILE)
                ? fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-300).join("\n")
                : "";
            } catch {
              text = "";
            }
            json(res, 200, { file: LOG_FILE, text });
            return;
          }
          if (method === "POST" && url === "/log") {
            const body = JSON.parse((await readBody(req)) || "{}") as {
              t?: string;
              level?: string;
              tag?: string;
              msg?: string;
              data?: unknown;
            };
            const line = `${body.t || new Date().toISOString()} ${(body.level || "info").toUpperCase()} ${body.tag || "app"}: ${body.msg || ""}${
              body.data === undefined ? "" : " " + JSON.stringify(body.data)
            }`;
            appendLog(line);
            json(res, 200, { ok: true });
            return;
          }

          if (method === "GET" && (url === "/projects" || url === "/projects/")) {
            const projects = listProjectIds().map((id) => projectPayload(id));
            logLine("api", "list projects", { count: projects.length });
            json(res, 200, { projects });
            return;
          }

          const match = url.match(/^\/projects\/([^/]+)(?:\/([a-z][a-z-]*))?$/);
          if (match) {
            const id = match[1];
            const action = match[2] || "get";

            if (method === "GET" && action === "get") {
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "reorder") {
              const body = JSON.parse((await readBody(req)) || "{}") as { id_order?: string[] };
              const order = body.id_order;
              if (!Array.isArray(order)) {
                json(res, 400, { error: "id_order required" });
                return;
              }
              const result = await runLayerCore(["reorder", projectDir(id), order.join(",")]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "reorder failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "group") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                member_ids?: string[];
                name?: string;
              };
              const members = body.member_ids;
              if (!Array.isArray(members) || members.length < 2) {
                json(res, 400, { error: "member_ids (2+) required" });
                return;
              }
              const result = await runLayerCore(["group", projectDir(id), members.join(",")].concat(
                body.name ? ["--name", body.name] : [],
              ));
              logLine("api", "group", { id, members, name: body.name, ok: result.ok });
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "group failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "ungroup") {
              const body = JSON.parse((await readBody(req)) || "{}") as { group_id?: string };
              if (!body.group_id) {
                json(res, 400, { error: "group_id required" });
                return;
              }
              const result = await runLayerCore(["ungroup", projectDir(id), body.group_id]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "ungroup failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "collapse") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                group_id?: string;
                collapsed?: boolean;
              };
              if (!body.group_id) {
                json(res, 400, { error: "group_id required" });
                return;
              }
              const args = ["collapse", projectDir(id), body.group_id];
              if (!body.collapsed) args.push("--open");
              const result = await runLayerCore(args);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "collapse failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && (action === "rename" || action === "rename-group")) {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                id?: string;
                group_id?: string;
                name?: string;
              };
              const name = (body.name || "").trim();
              const target = action === "rename" ? body.id : body.group_id;
              if (!target) {
                json(res, 400, { error: action === "rename" ? "id required" : "group_id required" });
                return;
              }
              if (!name) {
                json(res, 400, { error: "name required" });
                return;
              }
              const result = await runLayerCore([action, projectDir(id), String(target), name]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || `${action} failed` });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "delete") {
              const body = JSON.parse((await readBody(req)) || "{}") as { id?: string };
              if (!body.id) {
                json(res, 400, { error: "id required" });
                return;
              }
              const result = await runLayerCore(["delete", projectDir(id), String(body.id)]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "delete failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "flag") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                id?: string;
                visible?: boolean;
                locked?: boolean;
              };
              if (!body.id) {
                json(res, 400, { error: "id required" });
                return;
              }
              if (typeof body.visible !== "boolean" && typeof body.locked !== "boolean") {
                json(res, 400, { error: "visible or locked required" });
                return;
              }
              const args = ["flag", projectDir(id), String(body.id)];
              if (typeof body.visible === "boolean") args.push("--visible", body.visible ? "1" : "0");
              if (typeof body.locked === "boolean") args.push("--locked", body.locked ? "1" : "0");
              const result = await runLayerCore(args);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "flag failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "layout") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                layers?: Array<{ id?: string; x?: number; y?: number; w?: number; h?: number }>;
                groups?: Array<{ id?: string; x?: number; y?: number; w?: number; h?: number }>;
              };
              const pick = (list: typeof body.layers) =>
                (list || [])
                  .filter((item) => item && typeof item.id === "string")
                  .map((item) => ({
                    id: item.id,
                    x: Number(item.x) || 0,
                    y: Number(item.y) || 0,
                    ...(Number(item.w) > 0 ? { w: Number(item.w) } : {}),
                    ...(Number(item.h) > 0 ? { h: Number(item.h) } : {}),
                  }));
              const layers = pick(body.layers);
              const groups = pick(body.groups);
              if (!layers.length && !groups.length) {
                json(res, 400, { error: "no layout items" });
                return;
              }
              const result = await runLayerCore([
                "layout",
                projectDir(id),
                JSON.stringify({ layers, groups }),
              ]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "layout failed" });
                return;
              }
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "compose") {
              const result = await runLayerCore(["compose", projectDir(id)]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "compose failed" });
                return;
              }
              const payload = projectPayload(id);
              payload.compositeUrl = `/projects/${id}/composite.png?ts=${Date.now()}`;
              json(res, 200, { ...payload, output: result.stdout });
              return;
            }

            if (method === "POST" && action === "source") {
              // Store an uploaded source image (data URL or raw base64) as <project>/source.png
              const body = JSON.parse((await readBody(req)) || "{}") as {
                dataUrl?: string;
                base64?: string;
                filename?: string;
              };
              let base64 = body.base64;
              if (!base64 && body.dataUrl) {
                const comma = body.dataUrl.indexOf(",");
                base64 = comma >= 0 ? body.dataUrl.slice(comma + 1) : body.dataUrl;
              }
              if (!base64) {
                json(res, 400, { error: "dataUrl or base64 required" });
                return;
              }
              const dir = projectDir(id);
              const ext = (body.filename || "source.png").toLowerCase().endsWith(".jpg") ||
                (body.filename || "").toLowerCase().endsWith(".jpeg")
                ? "jpg"
                : (body.filename || "").toLowerCase().endsWith(".webp")
                  ? "webp"
                  : "png";
              const outName = `source.${ext === "jpg" ? "jpg" : ext === "webp" ? "webp" : "png"}`;
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, outName), Buffer.from(base64, "base64"));
              json(res, 200, projectPayload(id));
              return;
            }

            if (method === "POST" && action === "decompose") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                source?: string;
                dataUrl?: string;
                base64?: string;
                layers?: number;
              };
              const dir = projectDir(id);
              let sourcePath = body.source ? path.resolve(REPO_ROOT, body.source) : null;

              // Accept inline image upload as source.
              let inline = body.base64;
              if (!inline && body.dataUrl) {
                const comma = body.dataUrl.indexOf(",");
                inline = comma >= 0 ? body.dataUrl.slice(comma + 1) : body.dataUrl;
              }
              if (inline) {
                sourcePath = path.join(dir, "source.png");
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(sourcePath, Buffer.from(inline, "base64"));
              }

              if (!sourcePath) {
                sourcePath = ["source.png", "source.jpg", "source.jpeg", "source.webp"]
                  .map((name) => path.join(dir, name))
                  .find((p) => fs.existsSync(p)) || null;
              }
              if (!sourcePath || !fs.existsSync(sourcePath)) {
                json(res, 400, {
                  error: "source image required (upload dataUrl/base64 or place source.png in project)",
                });
                return;
              }

              const layerCount = body.layers ?? 3;
              const result = await runLayerCore([
                "decompose",
                dir,
                "--source",
                sourcePath,
                "--layers",
                String(layerCount),
              ]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "decompose failed" });
                return;
              }
              // Auto-compose after decompose so studio preview is fresh.
              await runLayerCore(["compose", dir]);
              json(res, 200, {
                ...projectPayload(id),
                provider: "mock/layered-v0",
                source: path.relative(REPO_ROOT, sourcePath).replace(/\\/g, "/"),
              });
              return;
            }

            if (method === "POST" && action === "export") {
              const body = JSON.parse((await readBody(req)) || "{}") as {
                out_dir?: string;
                formats?: string[];
              };
              const outDir = body.out_dir
                ? path.resolve(REPO_ROOT, body.out_dir)
                : path.join(projectDir(id), "dist");
              const formats = (body.formats || ["png-seq", "zip", "composite"]).join(",");
              const result = await runLayerCore([
                "export",
                projectDir(id),
                "--out",
                outDir,
                "--formats",
                formats,
              ]);
              if (!result.ok) {
                json(res, 500, { error: result.stderr || result.stdout || "export failed" });
                return;
              }
              json(res, 200, {
                out_dir: path.relative(REPO_ROOT, outDir).replace(/\\/g, "/"),
                files: result.stdout.split("\n").filter(Boolean),
              });
              return;
            }
          }

          json(res, 404, { error: `no route ${method} ${url}` });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}
