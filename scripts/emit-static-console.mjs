import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderConsoleHtml } from "../dist/server/page.js";

const target = resolve(process.argv[2] ?? "dist/console/index.html");
const inlineHtml = renderConsoleHtml({
  sessionToken: "",
  apiBase: "http://127.0.0.1:4173/",
});

const styleMatches = [...inlineHtml.matchAll(/<style>([\s\S]*?)<\/style>/g)];
const scriptMatches = [...inlineHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (styleMatches.length !== 1 || scriptMatches.length !== 1) {
  throw new Error("The console emitter requires exactly one inline style and one inline script.");
}

const css = styleMatches[0][1].trimStart();
const javascript = scriptMatches[0][1].trimStart();
const html = inlineHtml
  .replace(styleMatches[0][0], '<link rel="stylesheet" href="/conductor/console.css">')
  .replace(scriptMatches[0][0], '<script src="/conductor/console.js"></script>');

if (/<(?:style|script)(?:\s|>)/i.test(html.replace(/<script src="[^"]+"><\/script>/g, ""))) {
  throw new Error("The hosted console still contains an inline style or script block.");
}
if (/\sstyle\s*=/i.test(html)) {
  throw new Error("The hosted console still contains an inline style attribute.");
}

await mkdir(dirname(target), { recursive: true });
await Promise.all([
  writeFile(target, html, "utf8"),
  writeFile(resolve(dirname(target), "console.css"), css, "utf8"),
  writeFile(resolve(dirname(target), "console.js"), javascript, "utf8"),
]);
process.stdout.write(`Static Conductor console: ${target}\n`);
