/**
 * LayerForge debug logger.
 * - console (devtools)
 * - in-memory ring buffer for the UI panel
 * - batched POST /api/log (file cache on the Vite API side)
 */

export type LogItem = {
  t: string;
  level: "info" | "warn" | "error" | "debug";
  tag: string;
  msg: string;
  data?: unknown;
};

const MAX = 400;
const buffer: LogItem[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function now() {
  const d = new Date();
  return d.toISOString().slice(11, 23);
}

function emit() {
  for (const fn of listeners) fn();
}

function push(item: LogItem) {
  buffer.push(item);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  emit();
  // fire-and-forget to backend file log
  seq += 1;
  void fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  }).catch(() => {
    /* offline / no API — console already has it */
  });
}

function fmt(item: LogItem) {
  const extra =
    item.data === undefined
      ? ""
      : " " + (typeof item.data === "string" ? item.data : JSON.stringify(item.data));
  return `[${item.t}] ${item.level.toUpperCase()} ${item.tag}: ${item.msg}${extra}`;
}

export const log = {
  debug(tag: string, msg: string, data?: unknown) {
    const item: LogItem = { t: now(), level: "debug", tag, msg, data };
    console.debug(fmt(item));
    push(item);
  },
  info(tag: string, msg: string, data?: unknown) {
    const item: LogItem = { t: now(), level: "info", tag, msg, data };
    console.info(fmt(item));
    push(item);
  },
  warn(tag: string, msg: string, data?: unknown) {
    const item: LogItem = { t: now(), level: "warn", tag, msg, data };
    console.warn(fmt(item));
    push(item);
  },
  error(tag: string, msg: string, data?: unknown) {
    const item: LogItem = { t: now(), level: "error", tag, msg, data };
    console.error(fmt(item));
    push(item);
  },
};

export function getLogBuffer(): LogItem[] {
  return buffer.slice();
}

export function subscribeLogs(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearLogs() {
  buffer.length = 0;
  emit();
}
