import { Notice, TAbstractFile, TFile, normalizePath, type App, type Plugin } from "obsidian";
import { ApiError, KadimaApiClient } from "./api";
import { decideConflict } from "./conflicts";
import { PluginStore } from "./store";
import { isBlobPayload, isInlinePayload } from "./types";
import type {
  AppliedChangeAck,
  BootstrapKnownFile,
  KadimaSyncSettings,
  FileKind,
  PendingMutation,
  PushConflict,
  RemoteEntry,
  RemoteMutation,
  SyncPushChange
} from "./types";
import {
  buildConflictCopyPath,
  decodeInlinePayload,
  dirname,
  encodeInlinePayload,
  generateId,
  inferFileKind,
  sha256Hex,
  shouldSyncPath
} from "./utils";
import { KadimaAuthService } from "./auth";

type LocalFileSnapshot = {
  path: string;
  kind: FileKind;
  hash: string;
  size: number;
  value: string | ArrayBuffer;
};

export class KadimaSyncEngine {
  private syncTimer: number | null = null;
  private syncing = false;
  private suppressLocalEvents = false;

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly getSettings: () => KadimaSyncSettings,
    private readonly store: PluginStore,
    private readonly api: KadimaApiClient,
    private readonly auth: KadimaAuthService,
    private readonly setStatus: (status: string) => void
  ) {}

  start(): void {
    this.plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        void this.onVaultChanged(file, "upsert");
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        void this.onVaultChanged(file, "upsert");
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        void this.onVaultDeleted(file);
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        void this.onVaultRenamed(file, oldPath);
      })
    );

    this.app.workspace.onLayoutReady(() => {
      this.refreshSchedule();
      if (this.auth.isConnected() && this.getSettings().syncOnLaunch) {
        void this.syncNow("launch");
      }
    });
  }

  stop(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  refreshSchedule(): void {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    const intervalMs = Math.max(this.getSettings().autoSyncIntervalSeconds, 10) * 1000;
    this.syncTimer = window.setInterval(() => {
      void this.syncNow("interval");
    }, intervalMs);
  }

  async syncNow(reason: "launch" | "interval" | "save" | "manual"): Promise<void> {
    if (this.syncing) {
      return;
    }

    if (!this.auth.isConnected()) {
      if (reason === "manual") {
        new Notice("Connect Kadima before syncing.");
      }
      return;
    }

    this.syncing = true;
    this.setStatus("Syncing");

    try {
      await this.ensureBootstrap();
      await this.pullRemoteChanges();
      await this.pushPendingChanges();
      this.store.setLastSyncAt(Date.now());
      this.setStatus("Idle");
      if (reason === "manual") {
        new Notice("Kadima sync complete.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown sync error";
      this.store.setLastSyncError(message);
      this.setStatus("Sync error");
      if (reason === "manual" || !(error instanceof ApiError && error.status === 401)) {
        new Notice(`Kadima sync failed: ${message}`);
      }
    } finally {
      this.syncing = false;
    }
  }

  private getSelectedVaultId(): string | null {
    return this.store.auth?.vaultId ?? null;
  }

  private async onVaultChanged(
    file: TAbstractFile,
    operation: PendingMutation["operation"]
  ): Promise<void> {
    if (this.suppressLocalEvents || !(file instanceof TFile)) {
      return;
    }

    if (!shouldSyncPath(file.path, this.getSettings().syncHiddenFiles)) {
      return;
    }

    this.store.enqueueMutation({
      mutationId: generateId("mut"),
      path: file.path,
      operation,
      kind: inferFileKind(file.path),
      enqueuedAt: Date.now()
    });

    if (this.getSettings().syncOnSave) {
      await this.syncNow("save");
    }
  }

  private async onVaultDeleted(file: TAbstractFile): Promise<void> {
    if (this.suppressLocalEvents) {
      return;
    }

    const path = normalizePath(file.path);
    if (!shouldSyncPath(path, this.getSettings().syncHiddenFiles)) {
      return;
    }

    this.store.enqueueMutation({
      mutationId: generateId("mut"),
      path,
      operation: "delete",
      kind: this.store.getFileState(path)?.kind ?? inferFileKind(path),
      enqueuedAt: Date.now()
    });

    if (this.getSettings().syncOnSave) {
      await this.syncNow("save");
    }
  }

  private async onVaultRenamed(file: TAbstractFile, oldPath: string): Promise<void> {
    if (this.suppressLocalEvents || !(file instanceof TFile)) {
      return;
    }

    if (!shouldSyncPath(file.path, this.getSettings().syncHiddenFiles)) {
      return;
    }

    const kind = inferFileKind(file.path);
    this.store.renameFileState(oldPath, file.path, kind);
    this.store.enqueueMutation({
      mutationId: generateId("mut"),
      path: file.path,
      previousPath: oldPath,
      operation: "rename",
      kind,
      enqueuedAt: Date.now()
    });

    if (this.getSettings().syncOnSave) {
      await this.syncNow("save");
    }
  }

  private async ensureBootstrap(): Promise<void> {
    const selectedVaultId = this.getSelectedVaultId();
    if (!selectedVaultId) {
      throw new Error("No Kadima vault selected for this device.");
    }

    if (this.store.sync.vaultId !== selectedVaultId) {
      this.store.resetSyncState();
      this.store.setVaultId(selectedVaultId);
    }

    if (this.store.sync.vaultId && this.store.sync.cursor) {
      return;
    }

    const knownFiles = await this.buildKnownFileSnapshot();
    const response = await this.api.bootstrap({
      vaultId: selectedVaultId,
      knownFiles
    });

    this.store.setVaultId(response.vaultId);
    this.store.setCursor(response.cursor);

    const remotePaths = new Set(response.entries.map((entry) => entry.path));
    for (const entry of response.entries) {
      await this.applyRemoteEntry(entry);
    }

    for (const local of knownFiles) {
      if (!remotePaths.has(local.path)) {
        this.store.enqueueMutation({
          mutationId: generateId("mut"),
          path: local.path,
          operation: "upsert",
          kind: local.kind,
          enqueuedAt: Date.now()
        });
      }
    }
  }

  private async pullRemoteChanges(): Promise<void> {
    const vaultId = this.getSelectedVaultId() ?? this.store.sync.vaultId;
    if (!vaultId) {
      return;
    }

    let cursor = this.store.sync.cursor;
    let hasMore = true;

    while (hasMore) {
      const response = await this.api.pull({
        vaultId,
        cursor,
        limit: 200
      });

      for (const mutation of response.changes) {
        await this.applyRemoteMutation(mutation);
      }

      cursor = response.cursor;
      hasMore = response.hasMore;
      this.store.setCursor(response.cursor);
    }
  }

  private async pushPendingChanges(): Promise<void> {
    const vaultId = this.getSelectedVaultId() ?? this.store.sync.vaultId;
    if (!vaultId) {
      return;
    }

    const blockedPaths = this.store.unresolvedConflictPaths();
    const pending = this.store.sync.pendingMutations.filter(
      (mutation) =>
        !blockedPaths.has(mutation.path) &&
        !(mutation.previousPath && blockedPaths.has(mutation.previousPath))
    );

    if (pending.length === 0) {
      return;
    }

    const changes: SyncPushChange[] = [];
    for (const mutation of pending) {
      const change = await this.buildPushChange(vaultId, mutation);
      if (change) {
        changes.push(change);
      }
    }

    if (changes.length === 0) {
      return;
    }

    const response = await this.api.push({
      vaultId,
      cursor: this.store.sync.cursor,
      changes
    });

    this.store.setCursor(response.cursor);

    for (const applied of response.applied) {
      this.applyPushAck(applied);
    }

    this.store.removePendingMutations(response.applied.map((entry) => entry.mutationId));

    for (const conflict of response.conflicts) {
      await this.handlePushConflict(conflict);
    }
  }

  private async buildKnownFileSnapshot(): Promise<BootstrapKnownFile[]> {
    const entries = this.app.vault.getAllLoadedFiles();
    const knownFiles: BootstrapKnownFile[] = [];

    for (const entry of entries) {
      if (!(entry instanceof TFile)) {
        continue;
      }

      if (!shouldSyncPath(entry.path, this.getSettings().syncHiddenFiles)) {
        continue;
      }

      const snapshot = await this.readLocalFile(entry);
      knownFiles.push({
        path: snapshot.path,
        kind: snapshot.kind,
        hash: snapshot.hash,
        revision: this.store.getFileState(snapshot.path)?.lastSyncedRevision
      });
    }

    return knownFiles;
  }

  private async buildPushChange(
    vaultId: string,
    mutation: PendingMutation
  ): Promise<SyncPushChange | null> {
    if (!mutation.path) {
      console.warn("[KadimaSync] Skipping pending mutation with empty path", mutation);
      return null;
    }
    const fileState = this.store.getFileState(mutation.path);

    if (mutation.operation === "delete") {
      return {
        mutationId: mutation.mutationId,
        path: mutation.path,
        previousPath: mutation.previousPath,
        operation: "delete",
        kind: mutation.kind,
        baseRevision: fileState?.lastSyncedRevision
      };
    }

    if (mutation.operation === "rename") {
      return {
        mutationId: mutation.mutationId,
        path: mutation.path,
        previousPath: mutation.previousPath,
        operation: "rename",
        kind: mutation.kind,
        baseRevision: fileState?.lastSyncedRevision
      };
    }

    const abstract = this.app.vault.getAbstractFileByPath(mutation.path);
    if (!(abstract instanceof TFile)) {
      return {
        mutationId: mutation.mutationId,
        path: mutation.path,
        operation: "delete",
        kind: mutation.kind,
        baseRevision: fileState?.lastSyncedRevision
      };
    }

    const snapshot = await this.readLocalFile(abstract);
    const payload =
      snapshot.size <= this.getSettings().maxInlineBytes
        ? encodeInlinePayload(snapshot.kind, snapshot.value)
        : await this.uploadSnapshot(vaultId, mutation, snapshot);

    return {
      mutationId: mutation.mutationId,
      path: mutation.path,
      previousPath: mutation.previousPath,
      operation: "upsert",
      kind: snapshot.kind,
      baseRevision: fileState?.lastSyncedRevision,
      hash: snapshot.hash,
      payload
    };
  }

  private async uploadSnapshot(
    vaultId: string,
    mutation: PendingMutation,
    snapshot: LocalFileSnapshot
  ): Promise<SyncPushChange["payload"]> {
    const encoding = snapshot.kind === "text" ? "utf8" : "base64";
    const uploadSession = await this.api.createUploadSession({
      vaultId,
      mutationId: mutation.mutationId,
      path: snapshot.path,
      kind: snapshot.kind,
      encoding
    });

    await this.api.upload({
      method: uploadSession.uploadMethod,
      url: uploadSession.uploadUrl,
      headers: uploadSession.uploadHeaders,
      body: snapshot.value
    });

    return {
      ...uploadSession.payload,
      size: snapshot.size,
      hash: snapshot.hash
    };
  }

  private applyPushAck(ack: AppliedChangeAck): void {
    if (ack.previousPath && ack.previousPath !== ack.path) {
      this.store.removeFileState(ack.previousPath);
    }

    if (ack.deleted) {
      this.store.upsertFileState(ack.path, {
        kind: ack.kind,
        lastSyncedRevision: ack.revision,
        lastSyncedHash: ack.hash,
        deleted: true,
        updatedAt: Date.now()
      });
      return;
    }

    this.store.upsertFileState(ack.path, {
      kind: ack.kind,
      lastSyncedRevision: ack.revision,
      lastSyncedHash: ack.hash,
      deleted: false,
      updatedAt: Date.now()
    });
  }

  private async applyRemoteMutation(mutation: RemoteMutation): Promise<void> {
    if (!mutation.path) {
      console.warn("[KadimaSync] Skipping remote mutation with empty path", mutation);
      return;
    }
    if (!shouldSyncPath(mutation.path, this.getSettings().syncHiddenFiles)) {
      return;
    }

    const pending = this.store.sync.pendingMutations.find(
      (entry) => entry.path === mutation.path || entry.previousPath === mutation.path
    );

    if (!pending) {
      await this.applyRemoteEntry(mutation);
      return;
    }

    const localFile = this.app.vault.getAbstractFileByPath(mutation.path);
    const localSnapshot =
      localFile instanceof TFile ? await this.readLocalFile(localFile) : null;
    const currentState = this.store.getFileState(mutation.path);
    const remotePayload = mutation.deleted ? undefined : await this.resolveRemotePayload(mutation);
    const remoteText =
      mutation.kind === "text" && typeof remotePayload === "string"
        ? remotePayload
        : undefined;
    const localText =
      localSnapshot?.kind === "text" && typeof localSnapshot.value === "string"
        ? localSnapshot.value
        : undefined;

    const decision = decideConflict({
      kind: mutation.kind,
      lastSyncedHash: currentState?.lastSyncedHash,
      localHash: localSnapshot?.hash,
      remoteHash: mutation.hash,
      localText,
      remoteText
    });

    if (decision.action === "keep-local") {
      return;
    }

    if (decision.action === "merged" && decision.mergedText !== undefined) {
      await this.writeTextToPath(mutation.path, decision.mergedText);
      this.store.enqueueMutation({
        mutationId: generateId("mut"),
        path: mutation.path,
        operation: "upsert",
        kind: "text",
        enqueuedAt: Date.now()
      });
      return;
    }

    if (decision.action === "preserve-local-copy" && localSnapshot) {
      const conflictPath = buildConflictCopyPath(
        this.getSettings().conflictFolder,
        mutation.path,
        "local"
      );
      await this.writeSnapshotToPath(conflictPath, localSnapshot);
      this.store.addConflict({
        id: generateId("conflict"),
        path: mutation.path,
        conflictPath,
        reason: "remote changed while local edits were pending",
        preservedSide: "local",
        remoteRevision: mutation.revision,
        detectedAt: Date.now(),
        resolved: true
      });
      this.store.removePendingMutationsForPath(mutation.path);
      new Notice(`Kadima conflict preserved at ${conflictPath}`);
    }

    await this.applyRemoteEntry(mutation, remotePayload);
  }

  private async handlePushConflict(conflict: PushConflict): Promise<void> {
    const localFile = this.app.vault.getAbstractFileByPath(conflict.path);
    if (localFile instanceof TFile) {
      const snapshot = await this.readLocalFile(localFile);
      const conflictPath = buildConflictCopyPath(
        this.getSettings().conflictFolder,
        conflict.path,
        "local"
      );
      await this.writeSnapshotToPath(conflictPath, snapshot);
      this.store.addConflict({
        id: generateId("conflict"),
        path: conflict.path,
        conflictPath,
        reason: conflict.reason,
        preservedSide: "local",
        remoteRevision: conflict.remote.revision,
        detectedAt: Date.now(),
        resolved: true
      });
      new Notice(`Kadima conflict preserved at ${conflictPath}`);
    }

    this.store.removePendingMutations([conflict.mutationId]);
    await this.applyRemoteEntry(conflict.remote);
  }

  private async applyRemoteEntry(
    entry: RemoteEntry,
    resolvedPayload?: string | ArrayBuffer
  ): Promise<void> {
    const mutation = entry as RemoteMutation;
    if (!mutation.path) {
      console.warn("[KadimaSync] Skipping remote entry with empty path", mutation);
      return;
    }
    const existing = this.app.vault.getAbstractFileByPath(mutation.path);

    if (mutation.operation === "rename" && mutation.previousPath) {
      const source = this.app.vault.getAbstractFileByPath(mutation.previousPath);
      if (source instanceof TFile && source.path !== mutation.path) {
        await this.withSuppressedEvents(async () => {
          await this.app.vault.rename(source, mutation.path);
        });
        this.store.renameFileState(mutation.previousPath, mutation.path, mutation.kind);
      }
    }

    if (mutation.deleted) {
      if (existing instanceof TFile) {
        await this.withSuppressedEvents(async () => {
          await this.app.vault.delete(existing, true);
        });
      }
      this.store.upsertFileState(mutation.path, {
        kind: mutation.kind,
        lastSyncedRevision: mutation.revision,
        lastSyncedHash: mutation.hash,
        deleted: true,
        updatedAt: mutation.updatedAt
      });
      return;
    }

    // Only resolve payload and write if this isn't just a rename without changes
    if (mutation.operation !== "rename" || mutation.payload) {
      const payload = resolvedPayload ?? (await this.resolveRemotePayload(mutation));
      const current = this.app.vault.getAbstractFileByPath(mutation.path);
      await this.withSuppressedEvents(async () => {
        await this.writeResolvedPayload(mutation.path, mutation.kind, payload, current);
      });
    }

    this.store.upsertFileState(mutation.path, {
      kind: mutation.kind,
      lastSyncedRevision: mutation.revision,
      lastSyncedHash: mutation.hash,
      deleted: false,
      updatedAt: mutation.updatedAt
    });
  }

  private async resolveRemotePayload(entry: RemoteEntry): Promise<string | ArrayBuffer> {
    if (entry.payload) {
      if (isInlinePayload(entry.payload)) {
        return decodeInlinePayload(entry.payload);
      }

      if (isBlobPayload(entry.payload) && entry.payload.downloadUrl) {
        const buffer = await this.api.download(entry.payload.downloadUrl);
        return entry.kind === "text" ? new TextDecoder().decode(buffer) : buffer;
      }

      throw new Error(`Remote blob payload for ${entry.path} did not include a download URL.`);
    }

    throw new Error(`Remote entry ${entry.path} did not include any payload.`);
  }

  private async readLocalFile(file: TFile): Promise<LocalFileSnapshot> {
    const kind = inferFileKind(file.path);
    if (kind === "text") {
      const text = await this.app.vault.cachedRead(file);
      return {
        path: file.path,
        kind,
        hash: await sha256Hex(text),
        size: new TextEncoder().encode(text).byteLength,
        value: text
      };
    }

    const binary = await this.app.vault.readBinary(file);
    return {
      path: file.path,
      kind,
      hash: await sha256Hex(binary),
      size: binary.byteLength,
      value: binary
    };
  }

  private async writeSnapshotToPath(path: string, snapshot: LocalFileSnapshot): Promise<void> {
    await this.withSuppressedEvents(async () => {
      await this.writeResolvedPayload(path, snapshot.kind, snapshot.value);
    });
  }

  private async writeTextToPath(path: string, text: string): Promise<void> {
    await this.withSuppressedEvents(async () => {
      await this.writeResolvedPayload(path, "text", text);
    });
  }

  private async writeResolvedPayload(
    path: string,
    kind: FileKind,
    payload: string | ArrayBuffer,
    existing?: TAbstractFile | null
  ): Promise<void> {
    if (!path) {
      throw new Error("Cannot write file: path is empty");
    }
    await this.ensureFolder(dirname(path));
    const current = existing ?? this.app.vault.getAbstractFileByPath(path);

    if (kind === "text") {
      const text = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
      if (current instanceof TFile) {
        await this.app.vault.modify(current, text);
      } else {
        await this.app.vault.create(path, text);
      }
      return;
    }

    const binary =
      typeof payload === "string" ? decodeInlinePayload({ encoding: "base64", data: payload, size: 0 }) : payload;
    if (current instanceof TFile) {
      await this.app.vault.modifyBinary(current, binary as ArrayBuffer);
    } else {
      await this.app.vault.createBinary(path, binary as ArrayBuffer);
    }
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath) {
      return;
    }

    const segments = folderPath.split("/");
    let current = "";
    for (const segment of segments) {
      if (!segment) continue;
      current = current ? normalizePath(`${current}/${segment}`) : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async withSuppressedEvents<T>(work: () => Promise<T>): Promise<T> {
    this.suppressLocalEvents = true;
    try {
      return await work();
    } finally {
      this.suppressLocalEvents = false;
    }
  }
}
