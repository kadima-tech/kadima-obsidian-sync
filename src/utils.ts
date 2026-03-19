import { normalizePath } from "obsidian";
import { PLUGIN_ID } from "./constants";
import type { FileKind, InlinePayload } from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "zip",
  "7z",
  "gz",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "ico",
  "heic",
  "avif",
  "psd",
  "sketch",
  "fig"
]);

export function normalizeVaultPath(path: string): string {
  return normalizePath(path);
}

export function dirname(path: string): string {
  const normalized = normalizeVaultPath(path);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

export function inferFileKind(path: string): FileKind {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(extension) ? "binary" : "text";
}

export function shouldSyncPath(
  path: string,
  syncHiddenFiles: boolean,
  configDir = ".obsidian"
): boolean {
  const normalized = normalizeVaultPath(path);
  const pluginDataPrefix = normalizeVaultPath(`${configDir}/plugins/${PLUGIN_ID}/`);
  if (normalized.startsWith(pluginDataPrefix)) {
    return false;
  }

  if (syncHiddenFiles) {
    return true;
  }

  return !normalized.split("/").some((segment) => segment.startsWith("."));
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data =
    typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function encodeInlinePayload(
  kind: FileKind,
  value: string | ArrayBuffer
): InlinePayload {
  if (kind === "text") {
    const text = typeof value === "string" ? value : decoder.decode(value);
    return {
      encoding: "utf8",
      data: text,
      size: encoder.encode(text).byteLength
    };
  }

  const binary = typeof value === "string" ? encoder.encode(value).buffer : value;
  return {
    encoding: "base64",
    data: arrayBufferToBase64(binary),
    size: binary.byteLength
  };
}

export function decodeInlinePayload(payload: InlinePayload): string | ArrayBuffer {
  return payload.encoding === "utf8"
    ? payload.data
    : base64ToArrayBuffer(payload.data);
}

export function buildConflictCopyPath(
  conflictFolder: string,
  originalPath: string,
  side: "local" | "remote"
): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const normalizedOriginal = normalizeVaultPath(originalPath);
  const dotIndex = normalizedOriginal.lastIndexOf(".");
  const basename =
    dotIndex === -1 ? normalizedOriginal : normalizedOriginal.slice(0, dotIndex);
  const extension = dotIndex === -1 ? "" : normalizedOriginal.slice(dotIndex);
  return normalizeVaultPath(
    `${conflictFolder}/${basename} (${side} conflict ${stamp})${extension}`
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function generateId(prefix: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
