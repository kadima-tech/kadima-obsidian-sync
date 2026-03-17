import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "kadima-sync";
const FILES_TO_COPY = ["manifest.json", "main.js", "styles.css", "versions.json"];

function resolveVaultPath(inputPath) {
  const vaultPath = inputPath || process.env.OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    throw new Error(
      "Missing Obsidian vault path. Set OBSIDIAN_VAULT_PATH or pass the vault path explicitly.",
    );
  }

  return path.resolve(vaultPath);
}

export async function copyPluginToVault(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const vaultPath = resolveVaultPath(options.vaultPath);
  const destinationDir = path.join(
    vaultPath,
    ".obsidian",
    "plugins",
    PLUGIN_ID,
  );

  await fs.mkdir(destinationDir, { recursive: true });

  for (const fileName of FILES_TO_COPY) {
    const sourcePath = path.join(rootDir, fileName);
    const destinationPath = path.join(destinationDir, fileName);
    await fs.copyFile(sourcePath, destinationPath);
  }

  return destinationDir;
}
