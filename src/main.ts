import { Notice, Plugin } from "obsidian";
import { KadimaApiClient } from "./api";
import { KadimaAuthService } from "./auth";
import { DEFAULT_STATUS, PLUGIN_NAME } from "./constants";
import { KadimaSyncSettingTab } from "./settings";
import { PluginStore } from "./store";
import { KadimaSyncEngine } from "./sync";
import type { KadimaSyncSettings } from "./types";

export default class KadimaSyncPlugin extends Plugin {
  store!: PluginStore;
  auth!: KadimaAuthService;
  private api!: KadimaApiClient;
  private sync!: KadimaSyncEngine;
  private statusEl!: HTMLElement;

  override async onload(): Promise<void> {
    this.store = new PluginStore(this);
    await this.store.load();

    this.statusEl = this.addStatusBarItem();
    this.setStatus(DEFAULT_STATUS);

    this.api = new KadimaApiClient(
      () => this.store.settings,
      async () => this.auth?.ensureValidAccessToken() ?? null
    );

    this.auth = new KadimaAuthService(
      this.app,
      this.manifest.version,
      () => this.store.settings,
      this.store,
      this.api,
      (status) => this.setStatus(status)
    );

    this.sync = new KadimaSyncEngine(
      this.app,
      this,
      () => this.store.settings,
      this.store,
      this.api,
      this.auth,
      (status) => this.setStatus(status)
    );

    this.addSettingTab(new KadimaSyncSettingTab(this.app, this));
    this.registerCommands();
    this.sync.start();
  }

  override async onunload(): Promise<void> {
    this.sync?.stop();
    await this.store?.flush();
  }

  async connectAccount(): Promise<void> {
    try {
      await this.auth.connect();
      new Notice(`${PLUGIN_NAME} connected.`);
      await this.sync.syncNow("manual");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown connection error";
      new Notice(`Failed to connect Kadima: ${message}`);
    }
  }

  async disconnectAccount(): Promise<void> {
    await this.auth.disconnect();
    new Notice(`${PLUGIN_NAME} disconnected.`);
  }

  async syncNow(): Promise<void> {
    await this.sync.syncNow("manual");
  }

  async updateSettings(next: Partial<KadimaSyncSettings>): Promise<void> {
    this.store.updateSettings(next);
    await this.store.flush();
    this.sync.refreshSchedule();
  }

  private registerCommands(): void {
    this.addCommand({
      id: "connect-kadima-account",
      name: "Connect Kadima account",
      callback: () => {
        void this.connectAccount();
      }
    });

    this.addCommand({
      id: "sync-now",
      name: "Sync now",
      callback: () => {
        void this.syncNow();
      }
    });

    this.addCommand({
      id: "disconnect-kadima-account",
      name: "Disconnect Kadima account",
      callback: () => {
        void this.disconnectAccount();
      }
    });

    this.addCommand({
      id: "reset-local-sync-state",
      name: "Reset local sync state",
      callback: async () => {
        this.store.resetSyncState();
        await this.store.flush();
        new Notice("Kadima local sync state reset.");
      }
    });
  }

  private setStatus(status: string): void {
    if (this.statusEl) {
      this.statusEl.setText(`${PLUGIN_NAME}: ${status || DEFAULT_STATUS}`);
    }
  }
}
