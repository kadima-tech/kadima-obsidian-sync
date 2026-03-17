import { App, PluginSettingTab, Setting } from "obsidian";
import type KadimaSyncPlugin from "./main";

export class KadimaSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KadimaSyncPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    const snapshot = this.plugin.store.snapshot();

    containerEl.empty();
    containerEl.createEl("h2", { text: "Kadima Sync" });

    new Setting(containerEl)
      .setName("Connection")
      .setDesc(
        snapshot.auth
          ? `Connected as ${this.plugin.auth.connectionLabel()}`
          : "Connect this vault to your Kadima account."
      )
      .addButton((button) =>
        button
          .setButtonText(snapshot.auth ? "Disconnect" : "Connect Kadima")
          .onClick(async () => {
            if (snapshot.auth) {
              await this.plugin.disconnectAccount();
            } else {
              await this.plugin.connectAccount();
            }
            this.display();
          })
      )
      .addButton((button) =>
        button.setButtonText("Sync now").onClick(async () => {
          await this.plugin.syncNow();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("The Kadima deployment to use for centralized auth and sync APIs.")
      .addText((text) =>
        text
          .setPlaceholder("https://www.kadima-tech.com")
          .setValue(this.plugin.store.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.store.updateSettings({
              apiBaseUrl: value.trim() || "https://www.kadima-tech.com"
            });
            await this.plugin.store.flush();
          })
      );

    new Setting(containerEl)
      .setName("Sync on launch")
      .setDesc("Run an immediate sync when the vault opens.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.store.settings.syncOnLaunch)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ syncOnLaunch: value });
          })
      );

    new Setting(containerEl)
      .setName("Sync on save")
      .setDesc("Attempt a background sync when notes change.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.store.settings.syncOnSave)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ syncOnSave: value });
          })
      );

    new Setting(containerEl)
      .setName("Sync hidden files")
      .setDesc("Include dotfiles such as `.obsidian` content.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.store.settings.syncHiddenFiles)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ syncHiddenFiles: value });
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval")
      .setDesc("How often the plugin polls Kadima for remote changes.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.store.settings.autoSyncIntervalSeconds))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 10) {
              await this.plugin.updateSettings({
                autoSyncIntervalSeconds: parsed
              });
            }
          })
      );

    new Setting(containerEl)
      .setName("Conflict folder")
      .setDesc("Where preserved conflict copies are written.")
      .addText((text) =>
        text
          .setValue(this.plugin.store.settings.conflictFolder)
          .onChange(async (value) => {
            await this.plugin.updateSettings({
              conflictFolder: value.trim() || ".kadima-conflicts"
            });
          })
      );

    new Setting(containerEl)
      .setName("Inline payload limit")
      .setDesc("Files larger than this will require signed upload/download support.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.store.settings.maxInlineBytes))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              await this.plugin.updateSettings({
                maxInlineBytes: parsed
              });
            }
          })
      );

    const note = containerEl.createDiv({ cls: "kadima-sync-setting-note" });
    note.setText(
      snapshot.sync.lastSyncAt
        ? `Last sync: ${new Date(snapshot.sync.lastSyncAt).toLocaleString()}`
        : "No sync has completed yet."
    );

    if (snapshot.sync.lastSyncError) {
      const error = containerEl.createDiv({ cls: "kadima-sync-setting-note" });
      error.setText(`Last error: ${snapshot.sync.lastSyncError}`);
    }
  }
}
