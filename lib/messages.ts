import type { AppState, EntryData, GroupData, GeneratorOptions, SaveMatchData, PendingCredentialData } from './types';

// ── Request types ──────────────────────────────────────────────

export type MessageRequest =
  | { type: 'GET_STATE' }
  | { type: 'CREATE_DATABASE'; payload: { name: string; password: string } }
  | { type: 'IMPORT_DATABASE'; payload: { data: number[]; password: string; rememberDurationMs: number } }
  | { type: 'UNLOCK'; payload: { password: string; rememberDurationMs: number } }
  | { type: 'CHANGE_MASTER_PASSWORD'; payload: { currentPassword: string; newPassword: string; rememberDurationMs: number } }
  | { type: 'LOCK' }
  | { type: 'SESSION_ACTIVITY' }
  | { type: 'GET_ENTRIES'; payload?: { groupId?: string; search?: string } }
  | { type: 'GET_BREACHED_ENTRY_IDS' }
  | { type: 'SAVE_BREACH_RESULTS'; payload: { results: Array<{ id: string; modified: string; breached: boolean }> } }
  | { type: 'GET_RECENT_ENTRY_IDS' }
  | { type: 'GET_ENTRY'; payload: { id: string } }
  | { type: 'CREATE_ENTRY'; payload: { entry: Omit<EntryData, 'id' | 'created' | 'modified'> } }
  | { type: 'IMPORT_CSV_ENTRIES'; payload: { entries: Array<Omit<EntryData, 'id' | 'created' | 'modified'>> } }
  | { type: 'UNDO_CSV_IMPORT'; payload: { ids: string[] } }
  | { type: 'UPDATE_ENTRY'; payload: { entry: EntryData } }
  | { type: 'GET_DELETE_PASSWORD_REQUIREMENT' }
  | { type: 'DELETE_ENTRY'; payload: { id: string; password?: string; rememberDurationMs?: number } }
  | { type: 'GET_GROUPS' }
  | { type: 'CREATE_GROUP'; payload: { name: string } }
  | { type: 'RENAME_GROUP'; payload: { id: string; name: string } }
  | { type: 'DELETE_GROUP'; payload: { id: string } }
  | { type: 'MOVE_ENTRIES'; payload: { ids: string[]; groupId: string } }
  | { type: 'GENERATE_PASSWORD'; payload?: Partial<GeneratorOptions> }
  | { type: 'COPY_TO_CLIPBOARD'; payload: { text: string; entryId?: string } }
  | { type: 'EXPORT_DATABASE' }
  | { type: 'DELETE_DATABASE'; payload: { password: string } }
  | { type: 'GET_ENTRIES_FOR_URL'; payload: { url: string } }
  | { type: 'GET_SAVE_CREDENTIAL_MATCH'; payload: { url: string; username: string } }
  | { type: 'UPDATE_ENTRY_PASSWORD'; payload: { id: string; title: string; url: string; username: string; password: string } }
  | { type: 'STORE_PENDING_CREDENTIALS'; payload: PendingCredentialData }
  | { type: 'TAKE_PENDING_CREDENTIALS' }
  | { type: 'FILL_IN_TAB'; payload: { tabId: number; entryId: string } }
  | { type: 'GET_BACKUP_HISTORY'; payload?: { limit?: number } }
  | { type: 'CREATE_BACKUP' }
  | { type: 'RESTORE_FROM_BACKUP'; payload: { timestamp: number; password: string; rememberDurationMs: number } }
  | { type: 'GET_STORAGE_HEALTH' }
  | { type: 'GET_ICON' };

// ── Response types ─────────────────────────────────────────────

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

export type StateResponse = MessageResponse<AppState>;

export type EntriesResponse = MessageResponse<EntryData[]>;

export type EntryResponse = MessageResponse<EntryData>;
export type ImportedEntriesResponse = MessageResponse<EntryData[]>;
export type SaveMatchResponse = MessageResponse<SaveMatchData | null>;
export type PendingCredentialResponse = MessageResponse<PendingCredentialData | null>;

export type GroupsResponse = MessageResponse<GroupData[]>;

export type GeneratePasswordResponse = MessageResponse<string>;

export type ExportResponse = MessageResponse<number[]>;

// ── New Response Types ──────────────────────────────────────────

export type BackupHistoryResponse = MessageResponse<{
    backups: Array<{
      timestamp: number;
      version: number;
      reason: string;
      size: number;
    }>;
    totalSize: number;
}>;

export type StorageHealthResponse = MessageResponse<{
    chromLocalSize: number;
    indexedDbSize: number;
    lastSyncTime: number;
    integrity: {
      checksumMatch: boolean;
      versionCount: number;
    };
    issues: string[];
}>;

// ── Constants ──────────────────────────────────────────────────

/** Error code returned when the service worker restarted and DB is no longer in memory */
export const NOT_UNLOCKED_ERROR = 'NOT_UNLOCKED';

/** Error code returned when an action requiring fresh password verification fails. */
export const INVALID_MASTER_PASSWORD_ERROR = 'INVALID_MASTER_PASSWORD';

/** Check if a response indicates the database was locked (e.g. service worker restart) */
export function isNotUnlockedError(res: MessageResponse): boolean {
  return !res.success && 'error' in res && res.error === NOT_UNLOCKED_ERROR;
}

// ── Helper to send messages to background ──────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const MESSAGE_TIMEOUT_MS = 5000;

/**
 * Send a message to the background service worker with retry logic and timeout.
 * The SW may still be starting up, so the first attempt can fail.
 * Each attempt has a timeout to prevent hanging forever.
 */
export async function sendMessage<T extends MessageResponse = MessageResponse>(
  message: MessageRequest,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await Promise.race([
        browser.runtime.sendMessage(message) as Promise<MessageResponse>,
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), MESSAGE_TIMEOUT_MS),
        ),
      ]);
      if (response !== undefined && response !== null) {
        return response as T;
      }
    } catch (err) {
      // Do not log request or response data here; messages may contain vault secrets.
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  return { success: false, error: 'Background service not available' } as T;
}
