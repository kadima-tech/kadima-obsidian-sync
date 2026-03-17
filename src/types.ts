export type FileKind = "text" | "binary";
export type SyncOperation = "upsert" | "delete" | "rename";

export interface KadimaSyncSettings {
  apiBaseUrl: string;
  autoSyncIntervalSeconds: number;
  conflictFolder: string;
  maxInlineBytes: number;
  syncOnLaunch: boolean;
  syncOnSave: boolean;
  syncHiddenFiles: boolean;
}

export interface UserSummary {
  uid: string;
  email?: string;
  displayName?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  connectedAt: number;
  user: UserSummary;
  capabilities?: string[];
}

export interface FileSyncState {
  path: string;
  kind: FileKind;
  lastSyncedRevision?: string;
  lastSyncedHash?: string;
  deleted?: boolean;
  updatedAt?: number;
}

export interface PendingMutation {
  mutationId: string;
  path: string;
  previousPath?: string;
  operation: SyncOperation;
  kind: FileKind;
  enqueuedAt: number;
}

export interface ConflictRecord {
  id: string;
  path: string;
  conflictPath: string;
  reason: string;
  preservedSide: "local" | "remote";
  remoteRevision?: string;
  detectedAt: number;
  resolved: boolean;
}

export interface SyncState {
  vaultId?: string;
  cursor?: string;
  lastSyncAt?: number;
  lastSyncError?: string;
  fileStates: Record<string, FileSyncState>;
  pendingMutations: PendingMutation[];
  conflicts: ConflictRecord[];
}

export interface PersistedPluginData {
  settings: KadimaSyncSettings;
  auth: AuthSession | null;
  sync: SyncState;
}

export interface DeviceAuthSessionResponse {
  sessionId: string;
  pollToken: string;
  approvalUrl: string;
  pollIntervalMs: number;
  expiresAt: number;
}

export interface DeviceAuthSessionStatusResponse {
  status: "pending" | "approved" | "expired";
  auth?: Omit<AuthSession, "connectedAt">;
}

export interface RefreshAuthSessionResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  capabilities?: string[];
}

export interface InlinePayload {
  mode?: "inline";
  encoding: "utf8" | "base64";
  data: string;
  size: number;
}

export interface UploadedBlobPayload {
  mode: "blob";
  objectPath: string;
  encoding: "utf8" | "base64";
  size?: number;
  contentType?: string;
  generation?: string;
  hash?: string;
}

export interface RemoteBlobPayload extends UploadedBlobPayload {
  storage?: "gcs";
  bucket?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: number;
}

export interface BootstrapKnownFile {
  path: string;
  kind: FileKind;
  hash: string;
  revision?: string;
}

export interface RemoteEntry {
  path: string;
  kind: FileKind;
  revision: string;
  hash?: string;
  deleted?: boolean;
  updatedAt: number;
  payload?: InlinePayload | RemoteBlobPayload;
}

export interface SyncBootstrapResponse {
  vaultId: string;
  cursor: string;
  entries: RemoteEntry[];
  capabilities?: string[];
}

export interface RemoteMutation extends RemoteEntry {
  mutationId: string;
  operation: SyncOperation;
  previousPath?: string;
}

export interface SyncPullResponse {
  cursor: string;
  hasMore: boolean;
  changes: RemoteMutation[];
}

export interface SyncPushChange {
  mutationId: string;
  path: string;
  previousPath?: string;
  operation: SyncOperation;
  kind: FileKind;
  baseRevision?: string;
  hash?: string;
  payload?: InlinePayload | UploadedBlobPayload;
}

export interface AppliedChangeAck {
  mutationId: string;
  path: string;
  previousPath?: string;
  operation: SyncOperation;
  kind: FileKind;
  revision: string;
  hash?: string;
  deleted?: boolean;
}

export interface PushConflict {
  mutationId: string;
  path: string;
  reason: string;
  remote: RemoteMutation;
}

export interface SyncPushResponse {
  cursor: string;
  applied: AppliedChangeAck[];
  conflicts: PushConflict[];
}

export interface UploadSessionResponse {
  bucket: string;
  objectPath: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
  expiresAt: number;
  payload: UploadedBlobPayload;
}

export function isInlinePayload(
  payload?: InlinePayload | UploadedBlobPayload | RemoteBlobPayload,
): payload is InlinePayload {
  return !!payload && payload.mode !== "blob";
}

export function isBlobPayload(
  payload?: InlinePayload | UploadedBlobPayload | RemoteBlobPayload,
): payload is UploadedBlobPayload | RemoteBlobPayload {
  return !!payload && payload.mode === "blob";
}
