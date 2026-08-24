import type { App } from "obsidian";
import { PluginStore } from "./store";
import { KadimaApiClient } from "./api";
import type { AuthSession, KadimaSyncSettings } from "./types";

/**
 * Browser URL for the pairing page. Prefer the API host this plugin is
 * configured with when the server returned a container bind address
 * (`0.0.0.0:8080` on Cloud Run).
 */
export function pairingApprovalUrl(
  apiBaseUrl: string,
  sessionId: string,
  serverApprovalUrl?: string,
): string {
  const fromApi = `${apiBaseUrl.replace(/\/+$/, "")}/obsidian/connect?sessionId=${encodeURIComponent(sessionId)}`;
  if (!serverApprovalUrl) return fromApi;
  try {
    const url = new URL(serverApprovalUrl);
    if (
      url.hostname === "0.0.0.0" ||
      url.hostname === "::" ||
      url.hostname === "[::]" ||
      url.hostname.endsWith(".run.app")
    ) {
      return fromApi;
    }
  } catch {
    return fromApi;
  }
  return serverApprovalUrl;
}

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

    // Open the connect page on the API host the plugin is talking to. The
    // server used to return request.nextUrl.origin, which on Cloud Run is
    // https://0.0.0.0:8080 — a URL no browser can load as Kadima.
    const approvalUrl = pairingApprovalUrl(
      this.getSettings().apiBaseUrl,
      session.sessionId,
      session.approvalUrl,
    );
    window.open(approvalUrl, "_blank", "noopener,noreferrer");
    this.setStatus("Waiting for Kadima approval");

    const status = await this.api.streamAuthSession(
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
      this.store.resetSyncState();
      this.store.setVaultId(auth.vaultId);
      this.store.setAuth(auth);
      this.setStatus(`Connected as ${auth.user.email ?? auth.user.uid}`);
      return auth;
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
      vaultId: refreshed.vaultId,
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
    this.store.resetSyncState();
    this.setStatus("Disconnected");
  }
}
