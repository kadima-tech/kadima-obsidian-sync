import type { FileKind } from "./types";

export interface ConflictDecisionInput {
  kind: FileKind;
  lastSyncedHash?: string;
  localHash?: string;
  remoteHash?: string;
  baseText?: string;
  localText?: string;
  remoteText?: string;
}

export interface ConflictDecision {
  action: "accept-remote" | "keep-local" | "merged" | "preserve-local-copy";
  mergedText?: string;
}

function tryAppendOnlyMerge(
  baseText: string,
  localText: string,
  remoteText: string
): string | null {
  if (!localText.startsWith(baseText) || !remoteText.startsWith(baseText)) {
    return null;
  }

  const localAppend = localText.slice(baseText.length);
  const remoteAppend = remoteText.slice(baseText.length);

  if (!localAppend || !remoteAppend) {
    return `${baseText}${localAppend}${remoteAppend}`;
  }

  if (localAppend === remoteAppend) {
    return `${baseText}${localAppend}`;
  }

  const left = localAppend.startsWith("\n") ? localAppend.slice(1) : localAppend;
  const right = remoteAppend.startsWith("\n") ? remoteAppend.slice(1) : remoteAppend;
  const separator = baseText.endsWith("\n") ? "" : "\n";
  return `${baseText}${separator}${left}\n${right}`;
}

export function decideConflict(input: ConflictDecisionInput): ConflictDecision {
  if (!input.lastSyncedHash || input.localHash === input.lastSyncedHash) {
    return { action: "accept-remote" };
  }

  if (input.remoteHash === input.lastSyncedHash) {
    return { action: "keep-local" };
  }

  if (
    input.kind === "text" &&
    input.baseText &&
    typeof input.localText === "string" &&
    typeof input.remoteText === "string"
  ) {
    const mergedText = tryAppendOnlyMerge(
      input.baseText,
      input.localText,
      input.remoteText
    );
    if (mergedText !== null) {
      return {
        action: "merged",
        mergedText
      };
    }
  }

  return { action: "preserve-local-copy" };
}
