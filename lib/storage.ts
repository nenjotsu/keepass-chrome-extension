import { STORAGE_KEY_DB, STORAGE_KEY_META } from './constants';
import type { DatabaseMeta } from './types';
import * as persistentStorage from './persistent-storage';
import type { StorageHealthReport, OperationId } from './storage-types';

/**
 * Storage helpers for saving/loading the encrypted .kdbx blob
 * and associated metadata.
 *
 * - chrome.storage.local: persistent across browser restarts (encrypted kdbx blob + meta)
 * - chrome.storage.session: temporary unlock material only when the user opts in.
 */

const SESSION_KEY_PASSWORD = 'session_password';
const SESSION_KEY_PASSWORD_EXPIRY = 'session_password_expires_at';
const SESSION_KEY_PASSWORD_DURATION = 'session_password_duration_ms';
const SESSION_KEY_UNLOCK_TOKEN = 'encrypted_unlock_token';
const LEGACY_UNLOCK_DRAFT_KEY = 'draft_unlock';

export interface RememberedUnlock {
  password: string;
  durationMs: number;
  expiresAt: number;
}

// ── Base64 helpers (efficient ArrayBuffer <-> string) ──────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Persistent storage (chrome.storage.local) ──────────────────

/** Save the encrypted database blob */
export async function saveDatabaseBlob(data: ArrayBuffer): Promise<void> {
  const base64 = arrayBufferToBase64(data);
  await browser.storage.local.set({ [STORAGE_KEY_DB]: base64 });

  // Verify the write succeeded
  const check = await browser.storage.local.get(STORAGE_KEY_DB);
  if (!check[STORAGE_KEY_DB]) {
    throw new Error('Failed to persist database to storage');
  }
  console.log(`Database saved: ${base64.length} chars (base64)`);
}

/** Load the encrypted database blob */
export async function loadDatabaseBlob(): Promise<ArrayBuffer | null> {
  const result = await browser.storage.local.get(STORAGE_KEY_DB);
  const base64 = result[STORAGE_KEY_DB] as string | undefined;
  if (!base64 || typeof base64 !== 'string') return null;
  return base64ToArrayBuffer(base64);
}

/** Check if a database exists in storage */
export async function hasDatabaseInStorage(): Promise<boolean> {
  const result = await browser.storage.local.get(STORAGE_KEY_DB);
  return !!result[STORAGE_KEY_DB];
}

/** Save database metadata */
export async function saveDatabaseMeta(meta: DatabaseMeta): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY_META]: meta });
}

/** Load database metadata */
export async function loadDatabaseMeta(): Promise<DatabaseMeta | null> {
  const result = await browser.storage.local.get(STORAGE_KEY_META);
  return (result[STORAGE_KEY_META] as DatabaseMeta) ?? null;
}

/** Remove database from storage completely */
export async function removeDatabaseFromStorage(): Promise<void> {
  await browser.storage.local.remove([STORAGE_KEY_DB, STORAGE_KEY_META]);
  await clearSessionSecrets();
}

// ── Session storage (survives SW restarts, cleared on browser quit) ──

/** Remove remembered unlock material and legacy password drafts. */
export async function clearSessionSecrets(): Promise<void> {
  try {
    await browser.storage.session.remove([
      SESSION_KEY_PASSWORD,
      SESSION_KEY_PASSWORD_EXPIRY,
      SESSION_KEY_PASSWORD_DURATION,
      SESSION_KEY_UNLOCK_TOKEN,
      LEGACY_UNLOCK_DRAFT_KEY,
    ]);
  } catch {
    // ignore
  }
}

/** Remove pre-opt-in unlock material while preserving a valid new remember choice. */
export async function clearLegacyUnlockMaterial(): Promise<void> {
  try {
    const current = await browser.storage.session.get([
      SESSION_KEY_PASSWORD,
      SESSION_KEY_PASSWORD_EXPIRY,
      SESSION_KEY_PASSWORD_DURATION,
    ]);
    const hasCurrentRememberedUnlock =
      typeof current[SESSION_KEY_PASSWORD] === 'string' &&
      typeof current[SESSION_KEY_PASSWORD_EXPIRY] === 'number' &&
      typeof current[SESSION_KEY_PASSWORD_DURATION] === 'number';
    const remove = [LEGACY_UNLOCK_DRAFT_KEY, SESSION_KEY_UNLOCK_TOKEN];
    if (!hasCurrentRememberedUnlock) {
      remove.push(SESSION_KEY_PASSWORD, SESSION_KEY_PASSWORD_EXPIRY, SESSION_KEY_PASSWORD_DURATION);
    }
    await browser.storage.session.remove(remove);
  } catch {
    // ignore
  }
}

/** Store the master password only after a successful, explicit opt-in unlock. */
export async function rememberUnlock(password: string, durationMs: number): Promise<void> {
  if (!password || !Number.isFinite(durationMs) || durationMs <= 0) {
    await clearRememberedUnlock();
    return;
  }
  await browser.storage.session.set({
    [SESSION_KEY_PASSWORD]: password,
    [SESSION_KEY_PASSWORD_EXPIRY]: Date.now() + durationMs,
    [SESSION_KEY_PASSWORD_DURATION]: durationMs,
  });
}

/** Read an unexpired remembered password; stale or malformed material is erased. */
export async function loadRememberedUnlock(): Promise<RememberedUnlock | null> {
  try {
    const result = await browser.storage.session.get([
      SESSION_KEY_PASSWORD,
      SESSION_KEY_PASSWORD_EXPIRY,
      SESSION_KEY_PASSWORD_DURATION,
    ]);
    const password = result[SESSION_KEY_PASSWORD];
    const expiresAt = result[SESSION_KEY_PASSWORD_EXPIRY];
    const durationMs = result[SESSION_KEY_PASSWORD_DURATION];
    if (
      typeof password !== 'string' || !password ||
      typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) ||
      typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0
    ) {
      await clearRememberedUnlock();
      return null;
    }
    if (expiresAt <= Date.now()) {
      await clearRememberedUnlock();
      return null;
    }
    return { password, durationMs, expiresAt };
  } catch {
    return null;
  }
}

/** Extend the remembered unlock window after explicit extension activity. */
export async function extendRememberedUnlock(durationMs: number): Promise<number | null> {
  const remembered = await loadRememberedUnlock();
  if (!remembered || remembered.durationMs !== durationMs) return null;
  const expiresAt = Date.now() + durationMs;
  try {
    await browser.storage.session.set({ [SESSION_KEY_PASSWORD_EXPIRY]: expiresAt });
    return expiresAt;
  } catch {
    await clearRememberedUnlock();
    return null;
  }
}

export async function clearRememberedUnlock(): Promise<void> {
  try {
    await browser.storage.session.remove([
      SESSION_KEY_PASSWORD,
      SESSION_KEY_PASSWORD_EXPIRY,
      SESSION_KEY_PASSWORD_DURATION,
    ]);
  } catch {
    // ignore
  }
}

// ── New Storage System (Dual Storage + Recovery) ──────────────────

/** Initialize all storage systems (local, session, IndexedDB) */
export async function initializeAllStorageSystems(): Promise<void> {
  const result = await persistentStorage.initializeAllStorage();
  if (!result.success) {
    console.warn('[storage] Storage initialization had warnings:', result.warnings);
  } else {
    console.log('[storage] All storage systems initialized successfully');
  }
}

/**
 * Remembered unlock material is opt-in, expires after inactivity, and is kept
 * only in chrome.storage.session so it is cleared when the browser exits.
 */

/**
 * Get health report for all storage systems.
 * Useful for debugging storage issues.
 */
export async function getStorageHealthReport(): Promise<StorageHealthReport> {
  return persistentStorage.getStorageHealthReport();
}

/**
 * Calculate checksum for a database blob.
 * Useful for integrity verification.
 */
export async function calculateDatabaseChecksum(blob: ArrayBuffer): Promise<string> {
  return persistentStorage.calculateChecksum(blob);
}

/**
 * Execute a storage operation atomically with operation tracking.
 * Wraps an operation so it can be logged and recovered on crash.
 */
export async function executeAtomicallyWithJournal<T>(
  operation: () => Promise<T>,
  operationType: string,
): Promise<T> {
  // Note: Full atomic operation support requires state-journal module
  // For now, this is a placeholder for future integration
  try {
    return await operation();
  } catch (err) {
    console.error(`[storage] Atomic operation '${operationType}' failed:`, err);
    throw err;
  }
}
