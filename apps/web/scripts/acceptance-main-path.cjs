const http = require("http");

function req(pathname, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: "127.0.0.1",
        port: 5173,
        path: pathname,
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
            data = { raw: d };
          }
          resolve({ status: res.statusCode, data });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  let failed = 0;
  const p0 = await req("/api/projects/demo");
  console.log("1 load", p0.status, "layers", p0.data.layers?.length, "groups", p0.data.groups?.length);

  const dec = await req("/api/projects/demo/decompose", "POST", { layers: 3 });
  console.log("2 decompose", dec.status, dec.data.layers?.map((l) => l.id).join(","));
  if (dec.status !== 200 || dec.data.layers?.length < 2) failed++;

  const g = await req("/api/projects/demo/group", "POST", {
    member_ids: ["mid", "fg"],
    name: "Content",
  });
  console.log("3 group", g.status, "groups", JSON.stringify(g.data.groups));
  if (g.status !== 200 || !g.data.groups?.length) failed++;

  const p1 = await req("/api/projects/demo");
  console.log("4 reload groups", p1.data.groups?.length, "memberIds", p1.data.groups?.[0]?.memberIds?.join(","));
  if (!p1.data.groups?.length) failed++;

  const ug = await req("/api/projects/demo/ungroup", "POST", { group_id: "g1" });
  console.log("5 ungroup", ug.status, "groups", ug.data.groups?.length);
  if (ug.status !== 200 || ug.data.groups?.length) failed++;

  const r = await req("/api/projects/demo/reorder", "POST", {
    id_order: ["fg", "mid", "base"],
  });
  console.log("6 reorder", r.status, r.data.layers?.map((l) => l.id).join(">"));
  if (r.status !== 200) failed++;

  const c = await req("/api/projects/demo/compose", "POST", {});
  console.log("7 compose", c.status, c.data.compositeUrl || c.data.error);
  if (c.status !== 200) failed++;

  // restore
  await req("/api/projects/demo/reorder", "POST", {
    id_order: ["base", "mid", "fg"],
  });

  console.log(failed === 0 ? "ACCEPTANCE OK" : `FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})();
