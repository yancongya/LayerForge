const http = require("http");

function req(options, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  const bad = '{"id_order":["x"]}';
  const c = await req(
    {
      host: "127.0.0.1",
      port: 5173,
      path: "/api/projects/demo/reorder",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bad) },
      timeout: 5000,
    },
    bad
  );
  console.log("POST bad order", c.status, c.body.slice(0, 240));
})();
