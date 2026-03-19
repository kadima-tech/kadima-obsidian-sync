import type { KadimaSyncSettings, SyncState } from "./types";

export const PLUGIN_ID = "kadima-sync";
export const PLUGIN_NAME = "Kadima Sync";
export const DEFAULT_STATUS = "Idle";

declare const __DEV__: boolean;

export const IS_DEV_BUILD = __DEV__;

export const DEFAULT_SETTINGS: KadimaSyncSettings = {
  apiBaseUrl: "https://www.kadima-tech.com",
  autoSyncIntervalSeconds: 30,
  conflictFolder: ".kadima-conflicts",
  maxInlineBytes: 256 * 1024,
  syncOnLaunch: true,
  syncOnSave: true,
  syncHiddenFiles: false
};

export function createDefaultSyncState(): SyncState {
  return {
    fileStates: {},
    pendingMutations: [],
    conflicts: []
  };
}
