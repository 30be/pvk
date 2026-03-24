import { cp } from "fs/promises";

// Bundle content script
await Bun.build({
  entrypoints: ["src/content.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
});

// Bundle popup script
await Bun.build({
  entrypoints: ["src/popup.ts"],
  outdir: "dist",
  target: "browser",
  minify: true,
});

// Copy static files
await cp("src/popup.html", "dist/popup.html");
await cp("src/content.css", "dist/content.css");
await cp("manifest.json", "dist/manifest.json");

console.log("Built to dist/");
