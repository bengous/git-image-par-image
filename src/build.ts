const root = new URL("..", import.meta.url);
const outdir = new URL("dist/", root).pathname;

const result = await Bun.build({ entrypoints: [new URL("src/main.ts", root).pathname], outdir, target: "browser", naming: "app.js" });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const page = await Bun.file(new URL("index.html", root)).text();
await Bun.write(
  `${outdir}index.html`,
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
${page}</body>
</html>
`,
);
console.log(`built ${outdir}index.html and ${outdir}app.js`);
