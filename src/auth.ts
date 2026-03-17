import type { App } from "obsidian";
import { sleep } from "./utils";
import { PluginStore } from "./store";
import { KadimaApiClient } from "./api";
import type { AuthSession, KadimaSyncSettings } from "./types";

export class KadimaAuthService {
  constructor(
    private readonly app: App,
    private readonly pluginVersion: string,
    private readonly getSettings: () => KadimaSyncSettings,
    private readonly store: PluginStore,
    private readonly api: KadimaApiClient,
    private readonly setStatus: (status: string) => void
  ) {}

  get session(): AuthSession | null {
    return this.store.auth;
  }

  isConnected(): boolean {
    return Boolean(this.store.auth?.refreshToken);
  }

  connectionLabel(): string {
    const session = this.store.auth;
    if (!session) {
      return "Disconnected";
    }
    return session.user.email ?? session.user.displayName ?? session.user.uid;
  }

  async connect(): Promise<AuthSession> {
    const session = await this.api.createAuthSession({
      vaultName: this.app.vault.getName(),
      pluginVersion: this.pluginVersion,
      platform: /Mobile/i.test(window.navigator.userAgent) ? "mobile" : "desktop"
    });

    window.open(session.approvalUrl, "_blank", "noopener,noreferrer");
    this.setStatus("Waiting for Kadima approval");

    while (Date.now() < session.expiresAt) {
      await sleep(session.pollIntervalMs);
      const status = await this.api.pollAuthSession(
        session.sessionId,
        session.pollToken,
      );

      if (status.status === "expired") {
        throw new Error("The Kadima login session expired.");
      }

      if (status.status === "approved" && status.auth) {
        const auth: AuthSession = {
          ...status.auth,
          connectedAt: Date.now()
        };
        this.store.setAuth(auth);
        this.setStatus(`Connected as ${auth.user.email ?? auth.user.uid}`);
        return auth;
      }
    }

    throw new Error("Timed out waiting for Kadima login approval.");
  }

  async ensureValidAccessToken(): Promise<string | null> {
    const session = this.store.auth;
    if (!session) {
      return null;
    }

    if (Date.now() < session.expiresAt - 60_000) {
      return session.accessToken;
    }

    return this.refresh();
  }

  async refresh(): Promise<string | null> {
    const session = this.store.auth;
    if (!session?.refreshToken) {
      return null;
    }

    const refreshed = await this.api.refreshAuthSession(session.refreshToken);
    this.store.setAuth({
      ...session,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? session.refreshToken,
      expiresAt: refreshed.expiresAt,
      capabilities: refreshed.capabilities ?? session.capabilities
    });
    return refreshed.accessToken;
  }

  async disconnect(): Promise<void> {
    const session = this.store.auth;
    if (session?.refreshToken) {
      try {
        await this.api.revokeAuthSession(session.refreshToken);
      } catch (error) {
        console.warn("[KadimaSync] Failed to revoke refresh token:", error);
      }
    }

    this.store.setAuth(null);
    this.setStatus("Disconnected");
  }
}
