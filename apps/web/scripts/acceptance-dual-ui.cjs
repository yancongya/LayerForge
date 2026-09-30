/** Dual-mode acceptance: same project, reorder persists, compose works. */
const http = require("http");

function req(path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: "127.0.0.1",
        port: 5173,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          let data = null;
          try {
            data = JSON.parse(d);
          } catch {
            data = { raw: d, parseError: true };
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function orderOf(layers) {
  return [...layers]
    .sort((a, b) => a.order - b.order)
    .map((l) => l.id)
    .join(">");
}

(async () => {
  let failed = 0;
  const p0 = await req("/api/projects/demo");
  console.log("1 load", p0.status, orderOf(p0.data.layers));

  const r1 = await req("/api/projects/demo/reorder", "POST", { id_order: ["fg", "mid", "bg"] });
  console.log("2 reorder A", r1.status, orderOf(r1.data.layers));
  if (orderOf(r1.data.layers) !== "fg>mid>bg") failed++;

  // simulate view switch reload
  const p1 = await req("/api/projects/demo");
  console.log("3 reload after switch", p1.status, orderOf(p1.data.layers));
  if (orderOf(p1.data.layers) !== "fg>mid>bg") failed++;

  const c = await req("/api/projects/demo/compose", "POST", {});
  console.log("4 compose", c.status, c.data.compositeUrl || c.data.error);
  if (c.status !== 200) failed++;

  const r2 = await req("/api/projects/demo/reorder", "POST", { id_order: ["bg", "mid", "fg"] });
  console.log("5 restore", r2.status, orderOf(r2.data.layers));
  if (orderOf(r2.data.layers) !== "bg>mid>fg") failed++;

  const bad = await req("/api/nope");
  console.log("6 non-json-style miss", bad.status, bad.data.error || bad.data.raw);
  if (bad.status !== 404 || !bad.data.error) failed++;

  console.log(failed === 0 ? "ACCEPTANCE OK" : `ACCEPTANCE FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
