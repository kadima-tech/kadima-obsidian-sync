import path from "node:path";
import { copyPluginToVault } from "./obsidian-copy.mjs";

const vaultPath = process.argv[2] || process.env.OBSIDIAN_VAULT_PATH;

try {
  const destination = await copyPluginToVault({
    rootDir: path.resolve(import.meta.dirname, ".."),
    vaultPath,
  });
  console.log(`Copied plugin build to ${destination}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to install plugin to Obsidian",
  );
  process.exitCode = 1;
}
