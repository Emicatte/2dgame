// Builds the Vercel Function apps/web/api/p2p.js from src/p2p/signalServer.ts.
//
// The function is committed as plain JavaScript on purpose: Vercel compiles TypeScript functions
// with the project's `typescript` package, and TypeScript 7 (used here) has no JavaScript compiler
// API. `pnpm --filter @scrapline/web build:api` regenerates it; a unit test fails if it is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = resolve(root, "src/p2p/signalServer.ts");
export const TARGET = resolve(root, "api/p2p.js");
export const HEADER =
  "// GENERATED from src/p2p/signalServer.ts by scripts/build-api.mjs. Do not edit: run\n" +
  "// `pnpm --filter @scrapline/web build:api`.\n";

export async function buildApi() {
  const { code } = await transform(readFileSync(SOURCE, "utf8"), {
    loader: "ts",
    format: "esm",
    target: "node20",
    legalComments: "inline",
  });
  return HEADER + code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildApi();
  writeFileSync(TARGET, out);
  console.log(`wrote ${TARGET} (${out.length} bytes)`);
}
