import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { renderConsoleHtml } from "../dist/server/page.js";

const target = resolve(process.argv[2] ?? "dist/console/index.html");
const inlineHtml = renderConsoleHtml({
  sessionToken: "",
  apiBase: "http://127.0.0.1:4173/",
  assetBase: "/conductor/",
});

if (/<(?:style|script)(?:\s|>)/i.test(inlineHtml.replace(/<script src="[^"]+" defer><\/script>/g, ""))) {
  throw new Error("The hosted console still contains an inline style or script block.");
}
if (/\sstyle\s*=/i.test(inlineHtml)) {
  throw new Error("The hosted console still contains an inline style attribute.");
}

await mkdir(dirname(target), { recursive: true });
await Promise.all([
  writeFile(target, inlineHtml, "utf8"),
  copyFile(
    resolve("dist/server/console.css"),
    resolve(dirname(target), "console.css"),
  ),
  copyFile(
    resolve("dist/server/console.js"),
    resolve(dirname(target), "console.js"),
  ),
]);
process.stdout.write(`Static Conductor console: ${target}\n`);
