import { expect, it, describe, beforeEach, afterEach, vi } from 'vitest';
import { KadimaSyncEngine } from '../src/sync';
import { FakeApp } from './mocks/obsidian';
import { PluginStore } from '../src/store';
import { KadimaApiClient } from '../src/api';
import { KadimaAuthService } from '../src/auth';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { DEFAULT_SETTINGS } from '../src/constants';

describe('Conflict Resolution Edge Cases', () => {
    let app: FakeApp;
    let store: PluginStore;
    let api: KadimaApiClient;
    let auth: KadimaAuthService;
    let engine: KadimaSyncEngine;
    let plugin: any;

    const API_BASE = 'https://api.kadima.ai';

    beforeEach(async () => {
        app = new FakeApp('Test Vault');
        plugin = {
            loadData: vi.fn().mockResolvedValue({}),
            saveData: vi.fn(),
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

        api = new KadimaApiClient(() => store.settings, async () => 'token');
        auth = new KadimaAuthService(app as any, '0.1.0', () => store.settings, store, api, (s) => {});
        engine = new KadimaSyncEngine(app as any, plugin, () => store.settings, store, api, auth, (s) => {
            if (s === 'Sync error' && store.sync.lastSyncError) console.error('[Sync Error]', store.sync.lastSyncError);
        });

        store.setAuth({
            accessToken: 'token', refreshToken: 'ref', expiresAt: Date.now() + 1000,
            vaultId: 'v1',
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
        throw new Error(`Timed out waiting for mutation on ${path}. Current: ${JSON.stringify(store.sync.pendingMutations)}`);
    }

    it('Scenario 1: Remote Deletes, Local Modifies (Conflict Copy)', async () => {
        app.vault.__setupFile('scen1.md', 'Base content');
        store.upsertFileState('scen1.md', { path: 'scen1.md', lastSyncedRevision: 'r0', lastSyncedHash: 'base-hash' });

        engine.start();
        const file = app.vault.getAbstractFileByPath('scen1.md');
        await app.vault.modify(file as any, 'Local modification');
        await waitForMutation('scen1.md');

        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c1', hasMore: false,
                    changes: [{
                        path: 'scen1.md', kind: 'text', revision: 'r1', deleted: true, updatedAt: Date.now()
                    }]
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({ cursor: 'c2', applied: [], conflicts: [] });
            })
        );

        await engine.syncNow('manual');

        expect(app.vault.getAbstractFileByPath('scen1.md')).toBeNull();
        const conflictCopy = app.vault.getAllLoadedFiles().find(f => f.path.includes('local conflict') && f.path.includes('scen1'));
        expect(conflictCopy).toBeTruthy();
    });

    it('Scenario 2: Binary File Conflict (Conflict Copy)', async () => {
        app.vault.__setupFile('scen2.png', new Uint8Array([1, 2, 3]).buffer);
        store.upsertFileState('scen2.png', { path: 'scen2.png', kind: 'binary', lastSyncedRevision: 'r0', lastSyncedHash: 'b0' });

        engine.start();
        await app.vault.modifyBinary(app.vault.getAbstractFileByPath('scen2.png') as any, new Uint8Array([4, 5, 6]).buffer);
        await waitForMutation('scen2.png');

        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c1', hasMore: false,
                    changes: [{
                        path: 'scen2.png', kind: 'binary', revision: 'r1', hash: 'b1', updatedAt: Date.now(),
                        payload: { mode: 'inline', encoding: 'base64', data: 'BwgJ', size: 3 }
                    }]
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({ cursor: 'c2', applied: [], conflicts: [] });
            })
        );

        await engine.syncNow('manual');

        const files = app.vault.getAllLoadedFiles();
        expect(files.find(f => f.path.includes('local conflict') && f.path.includes('scen2'))).toBeTruthy();
    });

    it('Scenario 3: Local Renames, Remote Modifies Old Path', async () => {
        app.vault.__setupFile('old-name.md', 'Content');
        store.upsertFileState('old-name.md', { path: 'old-name.md', lastSyncedRevision: 'r0', lastSyncedHash: 'h0' });

        engine.start();
        await app.vault.rename(app.vault.getAbstractFileByPath('old-name.md') as any, 'new-name.md');
        await waitForMutation('new-name.md');

        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c1', hasMore: false,
                    changes: [{
                        path: 'old-name.md', kind: 'text', revision: 'r1', updatedAt: Date.now(),
                        payload: { encoding: 'utf8', data: 'Remote modified old path', size: 25 }
                    }]
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({ cursor: 'c2', applied: [], conflicts: [] });
            })
        );

        await engine.syncNow('manual');
        
        expect(store.sync.lastSyncError).toBeUndefined();
        expect(app.vault.getAbstractFileByPath('new-name.md')).toBeTruthy();
        expect(app.vault.getAbstractFileByPath('old-name.md')).toBeTruthy();
    });

    it('Scenario 4: Bootstrap Overwrites when no local history', async () => {
        app.vault.__setupFile('note.md', 'Local content');
        store.resetSyncState();
        
        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/bootstrap`, () => {
                return HttpResponse.json({
                    vaultId: 'v1', cursor: 'c1',
                    entries: [{
                        path: 'note.md', kind: 'text', revision: 'r1', hash: 'remote-hash', updatedAt: Date.now(),
                        payload: { encoding: 'utf8', data: 'Remote content', size: 14 }
                    }]
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({ cursor: 'c1', hasMore: false, changes: [] });
            })
        );

        await engine.syncNow('launch');

        const content = await app.vault.read(app.vault.getAbstractFileByPath('note.md') as any);
        expect(content).toBe('Remote content');
    });

    it('Scenario 5: Conflict folder setting is respected', async () => {
        store.updateSettings({ conflictFolder: 'custom-conflicts' });
        app.vault.__setupFile('test.md', 'A');
        store.upsertFileState('test.md', { path: 'test.md', lastSyncedRevision: 'r0', lastSyncedHash: 'hA' });

        engine.start();
        await app.vault.modify(app.vault.getAbstractFileByPath('test.md') as any, 'B');
        await waitForMutation('test.md');

        server.use(
            http.post(`${API_BASE}/api/obsidian/sync/pull`, () => {
                return HttpResponse.json({
                    cursor: 'c1', hasMore: false,
                    changes: [{
                        path: 'test.md', kind: 'text', revision: 'r1', hash: 'hC', updatedAt: Date.now(),
                        payload: { encoding: 'utf8', data: 'C', size: 1 }
                    }]
                });
            }),
            http.post(`${API_BASE}/api/obsidian/sync/push`, () => {
                return HttpResponse.json({ cursor: 'c2', applied: [], conflicts: [] });
            })
        );

        await engine.syncNow('manual');

        const conflictFile = app.vault.getAllLoadedFiles().find(f => f.path.startsWith('custom-conflicts/'));
        expect(conflictFile).toBeTruthy();
    });
});
