import type { ExportResult, ProjectPayload } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...init,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  let data: (T & { error?: string }) | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T & { error?: string };
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && data.error
        ? String(data.error)
        : text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) ||
          `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  if (!data) throw new Error(`non-JSON response from ${url} (${res.status})`);
  return data;
}

export function listProjects() {
  return request<{ projects: ProjectPayload[] }>("/api/projects");
}

export function getProject(id: string) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}`);
}

export function reorderLayers(id: string, idOrder: string[]) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/reorder`, {
    method: "POST",
    body: JSON.stringify({ id_order: idOrder }),
  });
}

export function groupLayers(id: string, memberIds: string[], name?: string) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/group`, {
    method: "POST",
    body: JSON.stringify({ member_ids: memberIds, name }),
  });
}

export function ungroupLayers(id: string, groupId: string) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/ungroup`, {
    method: "POST",
    body: JSON.stringify({ group_id: groupId }),
  });
}

export function setGroupCollapsed(id: string, groupId: string, collapsed: boolean) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/collapse`, {
    method: "POST",
    body: JSON.stringify({ group_id: groupId, collapsed }),
  });
}

export function composeProject(id: string) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/compose`, {
    method: "POST",
    body: "{}",
  });
}

export function exportProject(id: string, formats: string[] = ["png-seq", "zip", "composite"]) {
  return request<ExportResult>(`/api/projects/${encodeURIComponent(id)}/export`, {
    method: "POST",
    body: JSON.stringify({ formats }),
  });
}

export function decomposeProject(
  id: string,
  opts: { dataUrl?: string; source?: string; layers?: number } = {},
) {
  return request<ProjectPayload>(`/api/projects/${encodeURIComponent(id)}/decompose`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read file failed"));
    reader.readAsDataURL(file);
  });
}
