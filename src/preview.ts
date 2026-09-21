const dist = new URL("../dist/", import.meta.url);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env["PORT"] ?? 4173),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const target = new URL(path === "/" ? "index.html" : `.${path}`, dist);
    const file = Bun.file(target);
    return target.href.startsWith(dist.href) && (await file.exists())
      ? new Response(file)
      : new Response("not found", { status: 404 });
  },
});
console.log(`http://localhost:${server.port}/`);
