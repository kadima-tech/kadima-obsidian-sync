import { requestUrl } from "obsidian";
import type {
  BootstrapKnownFile,
  DeviceAuthSessionResponse,
  DeviceAuthSessionStatusResponse,
  KadimaSyncSettings,
  RefreshAuthSessionResponse,
  SyncBootstrapResponse,
  SyncPullResponse,
  SyncPushChange,
  SyncPushResponse,
  UploadSessionResponse
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class KadimaApiClient {
  constructor(
    private readonly getSettings: () => KadimaSyncSettings,
    private readonly getAccessToken: () => Promise<string | null>
  ) {}

  async createAuthSession(payload: {
    vaultName: string;
    pluginVersion: string;
    platform: string;
  }): Promise<DeviceAuthSessionResponse> {
    return this.request<DeviceAuthSessionResponse>("/api/obsidian/auth/sessions", {
      method: "POST",
      body: payload
    });
  }

  async pollAuthSession(
    sessionId: string,
    pollToken: string,
  ): Promise<DeviceAuthSessionStatusResponse> {
    return this.request<DeviceAuthSessionStatusResponse>(
      `/api/obsidian/auth/sessions/${encodeURIComponent(
        sessionId,
      )}?pollToken=${encodeURIComponent(pollToken)}`
    );
  }

  async refreshAuthSession(refreshToken: string): Promise<RefreshAuthSessionResponse> {
    return this.request<RefreshAuthSessionResponse>("/api/obsidian/auth/refresh", {
      method: "POST",
      body: { refreshToken }
    });
  }

  async revokeAuthSession(refreshToken: string): Promise<void> {
    await this.request<void>("/api/obsidian/auth/revoke", {
      method: "POST",
      body: { refreshToken }
    });
  }

  async bootstrap(payload: {
    knownFiles: BootstrapKnownFile[];
    cursor?: string;
    vaultName: string;
  }): Promise<SyncBootstrapResponse> {
    return this.request<SyncBootstrapResponse>("/api/obsidian/sync/bootstrap", {
      method: "POST",
      auth: true,
      body: payload
    });
  }

  async pull(payload: {
    vaultId: string;
    cursor?: string;
    limit?: number;
  }): Promise<SyncPullResponse> {
    return this.request<SyncPullResponse>("/api/obsidian/sync/pull", {
      method: "POST",
      auth: true,
      body: payload
    });
  }

  async push(payload: {
    vaultId: string;
    cursor?: string;
    changes: SyncPushChange[];
  }): Promise<SyncPushResponse> {
    return this.request<SyncPushResponse>("/api/obsidian/sync/push", {
      method: "POST",
      auth: true,
      body: payload
    });
  }

  async createUploadSession(payload: {
    vaultId: string;
    mutationId: string;
    path: string;
    kind: "text" | "binary";
    encoding?: "utf8" | "base64";
    contentType?: string;
  }): Promise<UploadSessionResponse> {
    return this.request<UploadSessionResponse>("/api/obsidian/sync/upload-session", {
      method: "POST",
      auth: true,
      body: payload
    });
  }

  async upload(upload: {
    method: "PUT";
    url: string;
    headers?: Record<string, string>;
    body: string | ArrayBuffer;
  }): Promise<void> {
    const response = await requestUrl({
      url: upload.url,
      method: upload.method,
      headers: upload.headers,
      body: upload.body,
      throw: false
    });

    if (response.status >= 400) {
      throw new ApiError(
        `Upload failed with status ${response.status}`,
        response.status,
        response.text
      );
    }
  }

  async download(downloadUrl: string): Promise<ArrayBuffer> {
    const response = await requestUrl({
      url: downloadUrl,
      method: "GET",
      throw: false
    });

    if (response.status >= 400) {
      throw new ApiError(
        `Download failed with status ${response.status}`,
        response.status,
        response.text
      );
    }

    return response.arrayBuffer;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      auth?: boolean;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const { method = "GET", auth = false, body, headers = {} } = options;
    const url = joinUrl(this.getSettings().apiBaseUrl, path);
    const requestHeaders: Record<string, string> = {
      ...headers
    };

    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }

    if (auth) {
      const token = await this.getAccessToken();
      if (!token) {
        throw new ApiError("Not authenticated", 401);
      }
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    const response = await requestUrl({
      url,
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false
    });

    if (response.status >= 400) {
      const payload = response.json ?? response.text;
      const message =
        (payload as { error?: string } | undefined)?.error ??
        `Request failed with status ${response.status}`;
      throw new ApiError(message, response.status, payload);
    }

    return (response.json ?? undefined) as T;
  }
}
