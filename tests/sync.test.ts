import { expect, it, describe, beforeEach, afterEach, vi } from 'vitest';
import { KadimaSyncEngine } from '../src/sync';
import { FakeApp, Notice } from './mocks/obsidian';
import { PluginStore } from '../src/store';
import { KadimaApiClient } from '../src/api';
import { KadimaAuthService } from '../src/auth';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { DEFAULT_SETTINGS } from '../src/constants';

describe('KadimaSyncEngine Integration', () => {
    let app: FakeApp;
    let store: PluginStore;
    let api: KadimaApiClient;
    let auth: KadimaAuthService;
    let engine: KadimaSyncEngine;
    let plugin: any;

    const API_BASE = 'https://api.kadima.ai';

    beforeEach(async () => {
        app = new FakeApp('Test Vault');
        
        // Mock Plugin for store
        plugin = {
            loadData: vi.fn().mockResolvedValue({}),
            saveData: vi.fn().mockResolvedValue(undefined),
            registerEvent: vi.fn(),
        };

        store = new PluginStore(plugin);
        await store.load();
        store.updateSettings({ 
            ...DEFAULT_SETTINGS, 
            apiBaseUrl: API_BASE,
            syncOnLaunch: false,
            syncOnSave: false
        });

        api = new KadimaApiClient(
            () => store.settings,
            () => auth.ensureValidAccessToken()
        );

        auth = new KadimaAuthService(
            app as any,
            '0.1.0',
            () => store.settings,
            store,
            api,
            (s) => {}
        );

        engine = new KadimaSyncEngine(
            app as any,
            plugin,
            () => store.settings,
            store,
            api,
            auth,
            (s) => {
                if (s === 'Sync error' && store.sync.lastSyncError) {
                    console.error('[Sync Engine Error]', store.sync.lastSyncError);
                }
            }
        );

        // Setup authenticated state
        store.setAuth({
            accessToken: 'valid-token',
            refreshToken: 'refresh-token',
            expiresAt: Date.now() + 3600000,
            vaultId: 'v-123',
            connectedAt: Date.now(),
            user: { uid: 'user-1', email: 'test@example.com' }
        });

        // Default handlers to avoid unhandled requests causing failures
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/bootstrap`, () => {
                return HttpResponse.json({ vaultId: 'v-default', cursor: 'c-0', entries: [] });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({ cursor: store.sync.cursor || 'c-0', hasMore: false, changes: [] });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({ cursor: store.sync.cursor || 'c-0', applied: [], conflicts: [] });
            })
        );
    });

    afterEach(() => {
        engine.stop();
    });

    it('should bootstrap successfully and pull remote files', async () => {
        let bootstrapBody: any = null;
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/bootstrap`, async ({ request }) => {
                bootstrapBody = await request.json();
                return HttpResponse.json({
                    vaultId: 'v-123',
                    cursor: 'c-1',
                    entries: [
                        {
                            path: 'remote-file.md',
                            kind: 'text',
                            revision: 'rev-1',
                            hash: 'hash-1',
                            updatedAt: Date.now(),
                            payload: { encoding: 'utf8', data: 'Hello from remote', size: 17 }
                        }
                    ]
                });
            })
        );

        await engine.syncNow('launch');

        expect(store.sync.lastSyncError).toBeUndefined();
        expect(store.sync.vaultId).toBe('v-123');
        expect(bootstrapBody.vaultId).toBe('v-123');
        expect(app.vault.getAbstractFileByPath('remote-file.md')).not.toBeNull();
        expect(await app.vault.read(app.vault.getAbstractFileByPath('remote-file.md') as any)).toBe('Hello from remote');
    });

    it('should push local changes to the server', async () => {
        store.setVaultId('v-123');
        store.setCursor('c-1');

        engine.start(); // Start listening to events
        await app.vault.create('notified-file.md', 'I should be pushed');

        expect(store.sync.pendingMutations).toHaveLength(1);
        const mutationId = store.sync.pendingMutations[0].mutationId;

        let receivedPush: any = null;
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/push`, async ({ request }) => {
                receivedPush = await request.json();
                return HttpResponse.json({
                    cursor: 'c-2',
                    applied: [
                        {
                            mutationId: mutationId,
                            path: 'notified-file.md',
                            operation: 'upsert',
                            kind: 'text',
                            revision: 'rev-push-1',
                            hash: 'some-hash'
                        }
                    ],
                    conflicts: []
                });
            })
        );

        await engine.syncNow('manual');

        expect(store.sync.lastSyncError).toBeUndefined();
        expect(receivedPush).not.toBeNull();
        expect(receivedPush.changes[0].path).toBe('notified-file.md');
        expect(store.sync.pendingMutations).toHaveLength(0);
        expect(store.getFileState('notified-file.md')?.lastSyncedRevision).toBe('rev-push-1');
    });

    it('should ignore stale local sync state and bootstrap using the selected auth vault', async () => {
        store.setVaultId('stale-local-vault');
        store.setCursor('c-stale');
        store.setAuth({
            ...(store.auth!),
            vaultId: 'v-fresh'
        });

        let bootstrapBody: any = null;
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/bootstrap`, async ({ request }) => {
                bootstrapBody = await request.json();
                return HttpResponse.json({
                    vaultId: 'v-fresh',
                    cursor: 'c-fresh',
                    entries: []
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({ cursor: 'c-fresh', hasMore: false, changes: [] });
            })
        );

        await engine.syncNow('manual');

        expect(bootstrapBody.vaultId).toBe('v-fresh');
        expect(store.sync.vaultId).toBe('v-fresh');
        expect(store.sync.cursor).toBe('c-fresh');
        expect(store.sync.lastSyncError).toBeUndefined();
    });

    it('should handle remote deletions', async () => {
        store.setVaultId('v-123');
        store.setCursor('c-1');
        
        app.vault.__setupFile('deprecated.md', 'Old content');
        store.upsertFileState('deprecated.md', { lastSyncedRevision: 'rev-old', lastSyncedHash: 'hash-old' });

        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c-2',
                    hasMore: false,
                    changes: [
                        {
                            mutationId: 'mut-remote-del',
                            path: 'deprecated.md',
                            kind: 'text',
                            revision: 'rev-del',
                            deleted: true,
                            updatedAt: Date.now()
                        }
                    ]
                });
            })
        );

        await engine.syncNow('manual');

        expect(store.sync.lastSyncError).toBeUndefined();
        expect(app.vault.getAbstractFileByPath('deprecated.md')).toBeNull();
        expect(store.getFileState('deprecated.md')?.deleted).toBe(true);
    });

    it('should handle simple conflicts by creating a local copy', async () => {
        store.setVaultId('v-123');
        store.setCursor('c-1');

        app.vault.__setupFile('conflict.md', 'Base content');
        store.upsertFileState('conflict.md', { lastSyncedRevision: 'rev-0', lastSyncedHash: 'hash-0' });

        engine.start();
        await app.vault.modify(app.vault.getAbstractFileByPath('conflict.md') as any, 'Local change');

        // Mock push conflict
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({
                    cursor: 'c-3',
                    applied: [],
                    conflicts: [
                        {
                            mutationId: store.sync.pendingMutations[0].mutationId,
                            path: 'conflict.md',
                            reason: 'revision mismatch',
                            remote: {
                                path: 'conflict.md',
                                kind: 'text',
                                revision: 'rev-rem-1',
                                hash: 'hash-rem-1',
                                updatedAt: Date.now(),
                                payload: { encoding: 'utf8', data: 'Remote change', size: 13 }
                            }
                        }
                    ]
                });
            })
        );

        await engine.syncNow('manual');

        expect(store.sync.lastSyncError).toBeUndefined();
        
        // Verify conflict file exists
        const files = app.vault.getAllLoadedFiles();
        const conflictFile = files.find(f => f.path.startsWith('.kadima-conflicts/conflict'));
        expect(conflictFile).toBeDefined();
        
        // Main file should have remote content
        const mainFile = app.vault.getAbstractFileByPath('conflict.md');
        expect(await app.vault.read(mainFile as any)).toBe('Remote change');
    });
});
