import { useEffect, useState } from "react";
import { clearLogs, getLogBuffer, log, subscribeLogs, type LogItem } from "./log";

function useLogOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" && !(e.target as HTMLElement)?.closest("input,textarea")) {
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

/** Floating debug console (toggle with ` or button). */
export default function DebugPanel() {
  const [open, setOpen] = useLogOpen();
  const [items, setItems] = useState<LogItem[]>(getLogBuffer());
  const [remote, setRemote] = useState("");

  useEffect(() => subscribeLogs(() => setItems(getLogBuffer())), []);

  if (!open) {
    return (
      <button
        type="button"
        className="debug-fab"
        title="运行日志（` 切换）"
        onClick={() => setOpen(true)}
      >
        LOG
      </button>
    );
  }

  return (
    <div className="debug-panel">
      <div className="debug-head">
        <strong>运行日志</strong>
        <button
          type="button"
          onClick={() => {
            void fetch("/api/logs")
              .then((r) => r.json())
              .then((d: { text?: string }) => setRemote(d.text || "(empty)"))
              .catch((e) => setRemote(String(e)));
          }}
        >
          读服务端
        </button>
        <button type="button" onClick={() => log.info("debug", "manual checkpoint")}>
          打点
        </button>
        <button type="button" onClick={() => clearLogs()}>
          清空
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
      <div className="debug-body">
        <div className="debug-list">
          {items
            .slice()
            .reverse()
            .slice(0, 120)
            .map((it, i) => (
              <div key={i} className={`debug-line ${it.level}`}>
                <span className="t">{it.t}</span>
                <span className="tag">{it.tag}</span>
                <span className="msg">{it.msg}</span>
                {it.data !== undefined && (
                  <span className="data">
                    {typeof it.data === "string" ? it.data : JSON.stringify(it.data)}
                  </span>
                )}
              </div>
            ))}
        </div>
        {remote && <pre className="debug-remote">{remote}</pre>}
      </div>
      <div className="debug-foot">
        文件：<code>logs/layerforge.log</code> · POST /api/log · GET /api/logs
      </div>
    </div>
  );
}
