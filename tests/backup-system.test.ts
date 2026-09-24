import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshots: unknown[] = [];

vi.mock('@/lib/persistent-storage', () => ({
  calculateChecksum: vi.fn(async () => 'checksum'),
  saveBackupSnapshot: vi.fn(async (snapshot: unknown) => snapshots.push(snapshot)),
  getBackupSnapshots: vi.fn(async () => snapshots),
  getBackupSnapshot: vi.fn(),
}));

describe('backup history', () => {
  beforeEach(() => snapshots.splice(0));

  it('persists a manual snapshot and exposes it in history', async () => {
    const backups = await import('@/lib/backup-system');
    const blob = new Uint8Array([1, 2, 3]).buffer;
    const metadata = {
      name: 'Vault',
      lastModified: '2026-01-01T00:00:00.000Z',
      entryCount: 1,
    };

    await backups.createSnapshot(blob, metadata, 'manual');

    const history = await backups.getBackupHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reason: 'manual', size: 3, checksum: 'checksum', metadata });
  });
});
