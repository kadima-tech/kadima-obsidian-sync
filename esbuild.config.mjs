import esbuild from "esbuild";
import process from "node:process";
import path from "node:path";
import { copyPluginToVault } from "./scripts/obsidian-copy.mjs";

const production = process.argv[2] === "production";
const rootDir = process.cwd();
const obsidianVaultPath = process.env.OBSIDIAN_VAULT_PATH;

async function copyBuildToVaultIfConfigured() {
  if (!obsidianVaultPath) {
    return;
  }

  const destination = await copyPluginToVault({
    rootDir: path.resolve(rootDir),
    vaultPath: obsidianVaultPath
  });
  console.log(`[kadima-sync] Copied build to ${destination}`);
}

const obsidianCopyPlugin = {
  name: "obsidian-copy",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }

      try {
        await copyBuildToVaultIfConfigured();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[kadima-sync] Obsidian copy skipped: ${message}`);
      }
    });
  }
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [obsidianCopyPlugin],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr"
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
