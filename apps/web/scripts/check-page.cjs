const http = require("http");

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d, headers: res.headers }));
    }).on("error", reject);
  });
}

(async () => {
  const root = await get("http://127.0.0.1:5173/");
  console.log("ROOT", root.status, "root-div", root.body.includes('id="root"'), "main", root.body.includes("/src/main.tsx"));
  const main = await get("http://127.0.0.1:5173/src/main.tsx");
  console.log("MAIN", main.status, "len", main.body.length);
  const app = await get("http://127.0.0.1:5173/src/App.tsx");
  console.log("APP", app.status, "len", app.body.length);
  const api = await get("http://127.0.0.1:5173/api/projects");
  console.log("API", api.status, api.body.slice(0, 120));
  // follow imports from main to see if any 400/500
  const importIds = [...main.body.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  console.log("imports", importIds);
  for (const id of importIds) {
    const u = id.startsWith("http") ? id : "http://127.0.0.1:5173" + (id.startsWith("/") ? id : "/" + id);
    try {
      const r = await get(u);
      console.log(" ", r.status, u, "len", r.body.length);
    } catch (e) {
      console.log("  ERR", u, e.message);
    }
  }
})();
