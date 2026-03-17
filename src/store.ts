import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, createDefaultSyncState } from "./constants";
import type {
  AuthSession,
  ConflictRecord,
  KadimaSyncSettings,
  FileSyncState,
  PendingMutation,
  PersistedPluginData,
  SyncState
} from "./types";

function normalizeSyncState(sync?: Partial<SyncState>): SyncState {
  return {
    vaultId: sync?.vaultId,
    cursor: sync?.cursor,
    lastSyncAt: sync?.lastSyncAt,
    lastSyncError: sync?.lastSyncError,
    fileStates: sync?.fileStates ?? {},
    pendingMutations: sync?.pendingMutations ?? [],
    conflicts: sync?.conflicts ?? []
  };
}

export class PluginStore {
  private data: PersistedPluginData = {
    settings: { ...DEFAULT_SETTINGS },
    auth: null,
    sync: createDefaultSyncState()
  };

  private saveTimer: number | null = null;

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<void> {
    const loaded = (await this.plugin.loadData()) as Partial<PersistedPluginData> | null;
    this.data = {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(loaded?.settings ?? {})
      },
      auth: loaded?.auth ?? null,
      sync: normalizeSyncState(loaded?.sync)
    };
  }

  get settings(): KadimaSyncSettings {
    return this.data.settings;
  }

  get auth(): AuthSession | null {
    return this.data.auth;
  }

  get sync(): SyncState {
    return this.data.sync;
  }

  updateSettings(next: Partial<KadimaSyncSettings>): void {
    this.data.settings = {
      ...this.data.settings,
      ...next
    };
    this.scheduleSave();
  }

  setAuth(auth: AuthSession | null): void {
    this.data.auth = auth;
    this.scheduleSave();
  }

  setVaultId(vaultId: string): void {
    this.data.sync.vaultId = vaultId;
    this.scheduleSave();
  }

  setCursor(cursor: string): void {
    this.data.sync.cursor = cursor;
    this.scheduleSave();
  }

  setLastSyncAt(timestamp: number): void {
    this.data.sync.lastSyncAt = timestamp;
    this.data.sync.lastSyncError = undefined;
    this.scheduleSave();
  }

  setLastSyncError(message: string): void {
    this.data.sync.lastSyncError = message;
    this.scheduleSave();
  }

  getFileState(path: string): FileSyncState | undefined {
    return this.data.sync.fileStates[path];
  }

  upsertFileState(path: string, next: Partial<FileSyncState>): void {
    const existing = this.data.sync.fileStates[path];
    this.data.sync.fileStates[path] = {
      path,
      kind: next.kind ?? existing?.kind ?? "text",
      lastSyncedRevision: next.lastSyncedRevision ?? existing?.lastSyncedRevision,
      lastSyncedHash: next.lastSyncedHash ?? existing?.lastSyncedHash,
      deleted: next.deleted ?? existing?.deleted,
      updatedAt: next.updatedAt ?? existing?.updatedAt
    };
    this.scheduleSave();
  }

  renameFileState(oldPath: string, newPath: string, kind?: FileSyncState["kind"]): void {
    const existing = this.data.sync.fileStates[oldPath];
    if (!existing) {
      this.upsertFileState(newPath, { kind: kind ?? "text" });
      return;
    }

    delete this.data.sync.fileStates[oldPath];
    this.data.sync.fileStates[newPath] = {
      ...existing,
      path: newPath,
      kind: kind ?? existing.kind
    };
    this.scheduleSave();
  }

  removeFileState(path: string): void {
    delete this.data.sync.fileStates[path];
    this.scheduleSave();
  }

  enqueueMutation(mutation: PendingMutation): void {
    this.data.sync.pendingMutations = this.data.sync.pendingMutations
      .filter((existing) => {
        const samePreviousPath =
          existing.previousPath !== undefined &&
          mutation.previousPath !== undefined &&
          existing.previousPath === mutation.previousPath;
        const touchesCurrentPath =
          existing.path === mutation.path ||
          existing.previousPath === mutation.path ||
          existing.path === mutation.previousPath ||
          samePreviousPath;
        return !touchesCurrentPath;
      })
      .concat(mutation)
      .sort((left, right) => left.enqueuedAt - right.enqueuedAt);
    this.scheduleSave();
  }

  removePendingMutations(mutationIds: string[]): void {
    const ids = new Set(mutationIds);
    this.data.sync.pendingMutations = this.data.sync.pendingMutations.filter(
      (mutation) => !ids.has(mutation.mutationId)
    );
    this.scheduleSave();
  }

  removePendingMutationsForPath(path: string): void {
    this.data.sync.pendingMutations = this.data.sync.pendingMutations.filter(
      (mutation) => mutation.path !== path && mutation.previousPath !== path
    );
    this.scheduleSave();
  }

  addConflict(conflict: ConflictRecord): void {
    this.data.sync.conflicts = this.data.sync.conflicts
      .filter((entry) => entry.id !== conflict.id)
      .concat(conflict)
      .sort((left, right) => right.detectedAt - left.detectedAt);
    this.scheduleSave();
  }

  unresolvedConflictPaths(): Set<string> {
    return new Set(
      this.data.sync.conflicts
        .filter((conflict) => !conflict.resolved)
        .map((conflict) => conflict.path)
    );
  }

  resetSyncState(): void {
    this.data.sync = createDefaultSyncState();
    this.scheduleSave();
  }

  snapshot(): PersistedPluginData {
    return this.data;
  }

  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.plugin.saveData(this.data);
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.plugin.saveData(this.data);
    }, 150);
  }
}
