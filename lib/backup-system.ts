/**
 * Automated backup and snapshot system.
 * - Creates hourly snapshots automatically
 * - Creates snapshots when edit threshold (10 edits) is reached
 * - Maintains backup history (last 10 snapshots)
 * - Implements retention policy (30 days)
 */

import * as persistentStorage from './persistent-storage';
import type { DatabaseMeta } from './types';
import type { BackupEntry, BackupStatistics, IDBBackupSnapshot } from './storage-types';

// ── Constants ────────────────────────────────────────────────────

const HOURLY_SNAPSHOT_INTERVAL = 60 * 60 * 1000;  // 1 hour
const EDIT_THRESHOLD = 10;  // snapshots after N edits
const MAX_BACKUPS = 10;  // keep last N backups
const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days

// ── Global State ─────────────────────────────────────────────────

let editCounter = 0;
let lastSnapshotTime = 0;

// ── Initialization ───────────────────────────────────────────────

export async function initializeBackupSystem(): Promise<void> {
  try {
    console.log('[backup-system] Initializing backup system');

    // Load last snapshot time
    const history = await getBackupHistoryInternal(1);
    if (history.length > 0) {
      lastSnapshotTime = history[0].timestamp;
    }
    await pruneBackups();

    console.log('[backup-system] Backup system initialized');
  } catch (err) {
    console.warn('[backup-system] Initialization warning:', err);
  }
}

// ── Snapshot Creation ────────────────────────────────────────────

/**
 * Create a snapshot of the current database state.
 * Called manually, hourly, or after edit threshold.
 */
export async function createSnapshot(
  blob: ArrayBuffer,
  metadata: DatabaseMeta,
  reason: 'hourly' | 'edit_threshold' | 'manual',
): Promise<boolean> {
  try {
    const timestamp = Date.now();
    const version = Math.floor(timestamp / 1000);  // Use timestamp as version
    const checksum = await persistentStorage.calculateChecksum(blob);

    const snapshot: IDBBackupSnapshot = {
      timestamp,
      version,
      reason,
      blob,
      checksum,
      metadata,
      editCount: editCounter,
      autoSnapshot: reason !== 'manual',
    };

    await persistentStorage.saveBackupSnapshot(snapshot);
    console.log(`[backup-system] Creating ${reason} snapshot at ${new Date(timestamp).toISOString()}`);
    console.log(`  - Database: ${metadata.name} (${metadata.entryCount} entries)`);
    console.log(`  - Size: ${(blob.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Checksum: ${checksum.substring(0, 16)}...`);

    // Reset edit counter after snapshot
    if (reason === 'edit_threshold') {
      editCounter = 0;
    }

    lastSnapshotTime = timestamp;
    await pruneBackups();
    return true;
  } catch (err) {
    console.error('[backup-system] Failed to create snapshot:', err);
    return false;
  }
}

/**
 * Record an edit operation.
 * When counter reaches threshold, a snapshot is triggered.
 */
export function recordEdit(): void {
  editCounter++;
}

/**
 * Get the current edit counter.
 * Useful for determining if snapshot should be created.
 */
export function getEditCount(): number {
  return editCounter;
}

/**
 * Check if edit threshold has been reached.
 * Returns true if snapshot should be created.
 */
export function shouldCreateEditThresholdSnapshot(): boolean {
  return editCounter >= EDIT_THRESHOLD;
}

/**
 * Check if it's time for hourly snapshot.
 * Returns true if interval has passed since last snapshot.
 */
export function shouldCreateHourlySnapshot(): boolean {
  return Date.now() - lastSnapshotTime >= HOURLY_SNAPSHOT_INTERVAL;
}

// ── Backup History ───────────────────────────────────────────────

/**
 * Get backup history for UI display.
 */
export async function getBackupHistory(limit: number = 10): Promise<BackupEntry[]> {
  return getBackupHistoryInternal(limit);
}

async function getBackupHistoryInternal(limit: number = 10): Promise<BackupEntry[]> {
  const snapshots = await persistentStorage.getBackupSnapshots(limit);
  return snapshots.map((snapshot) => ({
    timestamp: snapshot.timestamp,
    version: snapshot.version,
    reason: snapshot.reason,
    size: snapshot.blob.byteLength,
    checksum: snapshot.checksum,
    metadata: snapshot.metadata,
  }));
}

// ── Snapshot Restoration ─────────────────────────────────────────

/**
 * Restore database from a previous snapshot by timestamp.
 */
export async function restoreSnapshot(timestamp: number): Promise<ArrayBuffer> {
  const snapshot = await persistentStorage.getBackupSnapshot(timestamp);
  if (!snapshot) throw new Error(`Snapshot ${timestamp} not found`);
  if (await persistentStorage.calculateChecksum(snapshot.blob) !== snapshot.checksum) {
    throw new Error('Backup integrity check failed. The snapshot was not restored.');
  }
  return snapshot.blob;
}

export async function clearBackupHistory(): Promise<void> {
  await persistentStorage.clearBackupSnapshots();
  lastSnapshotTime = 0;
  editCounter = 0;
}

// ── Backup Cleanup ───────────────────────────────────────────────

/**
 * Delete old backups according to retention policy.
 * - Keep max number of backups (MAX_BACKUPS)
 * - Delete backups older than retention period (BACKUP_RETENTION_MS)
 */
export async function pruneBackups(maxAge: number = BACKUP_RETENTION_MS): Promise<void> {
  try {
    await persistentStorage.pruneBackupSnapshots(Date.now() - maxAge, MAX_BACKUPS);
  } catch (err) {
    console.warn('[backup-system] Backup pruning failed:', err);
  }
}

// ── Statistics ───────────────────────────────────────────────────

/**
 * Get backup system statistics.
 */
export async function getBackupStatistics(): Promise<BackupStatistics> {
  try {
    const backups = await persistentStorage.getBackupSnapshots(Number.MAX_SAFE_INTEGER);
    const timestamps = backups.map((backup) => backup.timestamp);
    const totalStorageUsed = backups.reduce((sum, backup) => sum + backup.blob.byteLength, 0);
    return {
      totalBackups: backups.length,
      oldestBackup: timestamps.length ? Math.min(...timestamps) : null,
      newestBackup: timestamps.length ? Math.max(...timestamps) : null,
      totalStorageUsed,
      averageBackupSize: backups.length ? totalStorageUsed / backups.length : 0,
      autoSnapshotInterval: HOURLY_SNAPSHOT_INTERVAL,
      editThreshold: EDIT_THRESHOLD,
    };
  } catch (err) {
    console.warn('[backup-system] Failed to get backup statistics:', err);
    return {
      totalBackups: 0,
      oldestBackup: null,
      newestBackup: null,
      totalStorageUsed: 0,
      averageBackupSize: 0,
      autoSnapshotInterval: HOURLY_SNAPSHOT_INTERVAL,
      editThreshold: EDIT_THRESHOLD,
    };
  }
}

// ── Cleanup ──────────────────────────────────────────────────────

export function cleanup(): void {
  // No in-memory timer state is retained between service-worker lifetimes.
}
