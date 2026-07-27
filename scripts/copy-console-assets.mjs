import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/server", { recursive: true });
await Promise.all([
  copyFile("src/server/console.css", "dist/server/console.css"),
  copyFile("src/server/console.js", "dist/server/console.js"),
]);
