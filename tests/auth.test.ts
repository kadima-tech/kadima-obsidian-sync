import { expect, it, describe, beforeEach, vi } from 'vitest';
import { KadimaAuthService } from '../src/auth';
import { FakeApp } from './mocks/obsidian';
import { PluginStore } from '../src/store';
import { KadimaApiClient } from '../src/api';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { DEFAULT_SETTINGS } from '../src/constants';

describe('KadimaAuthService', () => {
    let app: FakeApp;
    let store: PluginStore;
    let api: KadimaApiClient;
    let auth: KadimaAuthService;

    const API_BASE = 'https://api.kadima.ai';

    beforeEach(async () => {
        app = new FakeApp('Test Vault');
        const plugin = {
            loadData: vi.fn().mockResolvedValue({}),
            saveData: vi.fn(),
        };
        store = new PluginStore(plugin as any);
        await store.load();
        store.updateSettings({ ...DEFAULT_SETTINGS, apiBaseUrl: API_BASE });

        api = new KadimaApiClient(
            () => store.settings,
            async () => store.auth?.accessToken ?? null
        );

        auth = new KadimaAuthService(
            app as any,
            '0.1.0',
            () => store.settings,
            store,
            api,
            () => {}
        );
    });

    it('should connect successfully using device flow', async () => {
        // 1. Mock session creation
        server.use(
            http.post(`${API_BASE}/api/obsidian/auth/sessions`, () => {
                return HttpResponse.json({
                    sessionId: 's-1',
                    pollToken: 'p-1',
                    approvalUrl: 'https://kadima.ai/approve',
                    pollIntervalMs: 10, // Fast for tests
                    expiresAt: Date.now() + 60000
                });
            })
        );

        // 2. Mock SSE stream — emits pending then approved
        server.use(
            http.get(`${API_BASE}/api/obsidian/auth/sessions/s-1`, () => {
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('event: pending\ndata: {}\n\n'));
                        controller.enqueue(encoder.encode(
                            `event: approved\ndata: ${JSON.stringify({
                                auth: {
                                    accessToken: 'at-1',
                                    refreshToken: 'rt-1',
                                    expiresAt: Date.now() + 3600000,
                                    vaultId: 'vault-1',
                                    user: { uid: 'u-1', email: 'test@example.com' }
                                }
                            })}\n\n`
                        ));
                        controller.close();
                    }
                });
                return new HttpResponse(stream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                    }
                });
            })
        );

        // Mock window.open
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        const session = await auth.connect();

        expect(session.accessToken).toBe('at-1');
        expect(session.vaultId).toBe('vault-1');
        expect(store.auth?.accessToken).toBe('at-1');
        expect(store.auth?.vaultId).toBe('vault-1');
        expect(openSpy).toHaveBeenCalledWith('https://kadima.ai/approve', '_blank', expect.any(String));
    });

    it('should connect when both SSE events arrive in a single chunk', async () => {
        server.use(
            http.post(`${API_BASE}/api/obsidian/auth/sessions`, () => {
                return HttpResponse.json({
                    sessionId: 's-2',
                    pollToken: 'p-2',
                    approvalUrl: 'https://kadima.ai/approve',
                    pollIntervalMs: 10,
                    expiresAt: Date.now() + 60000
                });
            })
        );

        // Both events in one chunk — exercises the buffer-draining while loop
        server.use(
            http.get(`${API_BASE}/api/obsidian/auth/sessions/s-2`, () => {
                const encoder = new TextEncoder();
                const combined =
                    'event: pending\ndata: {}\n\n' +
                    `event: approved\ndata: ${JSON.stringify({
                        auth: {
                            accessToken: 'at-2',
                            refreshToken: 'rt-2',
                            expiresAt: Date.now() + 3600000,
                            vaultId: 'vault-2',
                            user: { uid: 'u-2', email: 'single-chunk@example.com' }
                        }
                    })}\n\n`;
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(combined));
                        controller.close();
                    }
                });
                return new HttpResponse(stream, {
                    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
                });
            })
        );

        vi.spyOn(window, 'open').mockImplementation(() => null);

        const session = await auth.connect();
        expect(session.accessToken).toBe('at-2');
        expect(session.vaultId).toBe('vault-2');
        expect(store.auth?.accessToken).toBe('at-2');
    });

    it('should refresh token when needed', async () => {
        store.setAuth({
            accessToken: 'old-at',
            refreshToken: 'rt-1',
            expiresAt: Date.now() - 1000, // Expired
            vaultId: 'vault-1',
            connectedAt: Date.now() - 3600000,
            user: { uid: 'u-1' }
        });

        server.use(
            http.post(`${API_BASE}/api/obsidian/auth/refresh`, async ({ request }) => {
                const body = await request.json() as any;
                expect(body.refreshToken).toBe('rt-1');
                return HttpResponse.json({
                    accessToken: 'new-at',
                    expiresAt: Date.now() + 3600000,
                    vaultId: 'vault-1',
                });
            })
        );

        const token = await auth.ensureValidAccessToken();
        expect(token).toBe('new-at');
        expect(store.auth?.accessToken).toBe('new-at');
    });
});
