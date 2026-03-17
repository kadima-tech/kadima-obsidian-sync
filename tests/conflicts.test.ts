import { describe, it, expect } from 'vitest';
import { decideConflict } from '../src/conflicts';

describe('decideConflict Unit Tests', () => {
    it('should accept remote if local has not changed', () => {
        const result = decideConflict({
            kind: 'text',
            lastSyncedHash: 'hash-a',
            localHash: 'hash-a',
            remoteHash: 'hash-b',
            localText: 'initial',
            remoteText: 'changed'
        });
        expect(result.action).toBe('accept-remote');
    });

    it('should keep local if remote has not changed', () => {
        const result = decideConflict({
            kind: 'text',
            lastSyncedHash: 'hash-a',
            localHash: 'hash-b',
            remoteHash: 'hash-a',
            localText: 'changed',
            remoteText: 'initial'
        });
        expect(result.action).toBe('keep-local');
    });

    it('should merge if both sides only append', () => {
        const result = decideConflict({
            kind: 'text',
            lastSyncedHash: 'hash-a',
            localHash: 'hash-local',
            remoteHash: 'hash-remote',
            baseText: 'Line 1\n',
            localText: 'Line 1\nLine 2 (Local)',
            remoteText: 'Line 1\nLine 3 (Remote)'
        });
        expect(result.action).toBe('merged');
        expect(result.mergedText).toContain('Line 2 (Local)');
        expect(result.mergedText).toContain('Line 3 (Remote)');
    });

    it('should preserve local copy for binary files if both changed', () => {
        const result = decideConflict({
            kind: 'binary',
            lastSyncedHash: 'hash-0',
            localHash: 'hash-local',
            remoteHash: 'hash-remote'
        });
        expect(result.action).toBe('preserve-local-copy');
    });

    it('should preserve local copy if text changes are not simple appends', () => {
        const result = decideConflict({
            kind: 'text',
            lastSyncedHash: 'hash-a',
            localHash: 'hash-local',
            remoteHash: 'hash-remote',
            baseText: 'Line 1\nLine 2',
            localText: 'Changed Line 1\nLine 2',
            remoteText: 'Line 1\nChanged Line 2'
        });
        expect(result.action).toBe('preserve-local-copy');
    });

    it('should accept remote if no sync history exists (bootstrap case)', () => {
        const result = decideConflict({
            kind: 'text',
            lastSyncedHash: undefined,
            localHash: 'hash-local',
            remoteHash: 'hash-remote'
        });
        expect(result.action).toBe('accept-remote');
    });
});
