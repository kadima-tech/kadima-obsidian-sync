import { expect, it, describe, beforeEach, afterEach, vi } from 'vitest';
import { KadimaSyncEngine } from '../src/sync';
import { FakeApp } from './mocks/obsidian';
import { PluginStore } from '../src/store';
import { KadimaApiClient } from '../src/api';
import { KadimaAuthService } from '../src/auth';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { DEFAULT_SETTINGS } from '../src/constants';

describe('Advanced Sync Scenarios', () => {
    let app: FakeApp;
    let store: PluginStore;
    let api: KadimaApiClient;
    let auth: KadimaAuthService;
    let engine: KadimaSyncEngine;
    let plugin: any;

    const API_BASE = 'https://api.kadima.ai';

    beforeEach(async () => {
        app = new FakeApp('Advanced Vault');
        plugin = {
            loadData: vi.fn().mockResolvedValue({}),
            saveData: vi.fn(),
            registerEvent: vi.fn(),
        };
        store = new PluginStore(plugin);
        await store.load();
        store.updateSettings({ ...DEFAULT_SETTINGS, apiBaseUrl: API_BASE, syncOnLaunch: false, syncOnSave: false });
        api = new KadimaApiClient(() => store.settings, async () => 'token');
        auth = new KadimaAuthService(app as any, '0.1.0', () => store.settings, store, api, () => {});
        engine = new KadimaSyncEngine(app as any, plugin, () => store.settings, store, api, auth, (s) => {
             if (s === 'Sync error') console.error('[Sync Error]', store.sync.lastSyncError);
        });

        store.setAuth({
            accessToken: 'token', refreshToken: 'ref', expiresAt: Date.now() + 1000,
            connectedAt: Date.now(), user: { uid: 'u1' }
        });
        store.setVaultId('v1');
        store.setCursor('c0');
    });

    afterEach(() => engine.stop());

    async function waitForMutation(path: string) {
        for (let i = 0; i < 50; i++) {
            if (store.sync.pendingMutations.some(m => m.path === path)) return;
            await new Promise(r => setTimeout(r, 20));
        }
    }

    it('should handle many files being modified at once', async () => {
        engine.start();
        const fileCount = 20;
        for (let i = 0; i < fileCount; i++) {
            await app.vault.create(`file-${i}.md`, `Content ${i}`);
        }

        // Wait for all mutations to be enqueued
        for (let i = 0; i < 50; i++) {
            if (store.sync.pendingMutations.length >= fileCount) break;
            await new Promise(r => setTimeout(r, 20));
        }

        expect(store.sync.pendingMutations).toHaveLength(fileCount);

        let pushCount = 0;
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/push`, async ({ request }) => {
                pushCount++;
                const body = await request.json() as any;
                // Acknowledge all in one go
                return HttpResponse.json({
                    cursor: `c-push-${pushCount}`,
                    applied: body.changes.map((c: any) => ({
                        mutationId: c.mutationId,
                        path: c.path,
                        operation: c.operation,
                        kind: c.kind,
                        revision: `rev-${c.mutationId}`,
                        hash: c.hash
                    })),
                    conflicts: []
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({ cursor: 'c-pull-1', hasMore: false, changes: [] });
            })
        );

        await engine.syncNow('manual');

        expect(store.sync.lastSyncError).toBeUndefined();
        expect(store.sync.pendingMutations).toHaveLength(0);
        expect(pushCount).toBeGreaterThan(0);
    });

    it('should handle folder renames (path updates)', async () => {
        // Initial setup
        await app.vault.createFolder('folder-a');
        app.vault.__setupFile('folder-a/note.md', 'Content');
        store.upsertFileState('folder-a/note.md', { path: 'folder-a/note.md', lastSyncedRevision: 'r0', lastSyncedHash: 'h0' });

        engine.start();
        
        // Remote side renames folder-a to folder-b
        // Note: Obsidian protocol handles individual file renames, but folder renames often result in multiple file renames.
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c1', hasMore: false,
                    changes: [{
                        path: 'folder-b/note.md',
                        previousPath: 'folder-a/note.md',
                        operation: 'rename',
                        kind: 'text',
                        revision: 'r1',
                        updatedAt: Date.now()
                    }]
                });
            })
        );

        await engine.syncNow('manual');

        expect(app.vault.getAbstractFileByPath('folder-a/note.md')).toBeNull();
        expect(app.vault.getAbstractFileByPath('folder-b/note.md')).toBeTruthy();
        expect(store.getFileState('folder-b/note.md')?.lastSyncedRevision).toBe('r1');
    });

    it('should recover from network errors on pull', async () => {
        let callCount = 0;
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                callCount++;
                if (callCount === 1) {
                    return new HttpResponse(null, { status: 500 });
                }
                return HttpResponse.json({ cursor: 'c-ok', hasMore: false, changes: [] });
            })
        );

        await engine.syncNow('manual');
        expect(store.sync.lastSyncError).toBeDefined();

        await engine.syncNow('manual');
        expect(store.sync.lastSyncError).toBeUndefined();
        expect(store.sync.cursor).toBe('c-ok');
    });

    it('should handle large file uploads (blob mode)', async () => {
        // Force blob mode by setting a small maxInlineBytes
        store.updateSettings({ maxInlineBytes: 10 });
        
        const largeText = 'This is much longer than 10 bytes';
        engine.start();
        await app.vault.create('large.md', largeText);
        await waitForMutation('large.md');

        let sessionCreated = false;
        let uploadCalled = false;
        
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/upload-session`, () => {
                sessionCreated = true;
                return HttpResponse.json({
                    bucket: 'b1', objectPath: 'o1', uploadUrl: `${API_BASE}/upload/o1`,
                    uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: Date.now() + 60000,
                    payload: { mode: 'blob', objectPath: 'o1', encoding: 'utf8', size: largeText.length }
                });
            }),
            http.put(`${API_BASE}/upload/o1`, async ({ request }) => {
                const text = await request.text();
                expect(text).toBe(largeText);
                uploadCalled = true;
                return new HttpResponse(null, { status: 200 });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, async ({ request }) => {
                const body = await request.json() as any;
                expect(body.changes[0].payload.mode).toBe('blob');
                return HttpResponse.json({
                    cursor: 'c2', applied: [{
                        mutationId: body.changes[0].mutationId, path: 'large.md',
                        operation: 'upsert', kind: 'text', revision: 'r-blob-1'
                    }], conflicts: []
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({ cursor: 'c2', hasMore: false, changes: [] });
            })
        );

        await engine.syncNow('manual');

        expect(sessionCreated).toBe(true);
        expect(uploadCalled).toBe(true);
        expect(store.sync.lastSyncError).toBeUndefined();
        expect(store.getFileState('large.md')?.lastSyncedRevision).toBe('r-blob-1');
    });
});
