import type { AppState, EntryData, GroupData, GeneratorOptions } from './types';

// ── Request types ──────────────────────────────────────────────

export type MessageRequest =
  | { type: 'GET_STATE' }
  | { type: 'CREATE_DATABASE'; payload: { name: string; password: string } }
  | { type: 'IMPORT_DATABASE'; payload: { data: number[]; password: string } }
  | { type: 'UNLOCK'; payload: { password: string } }
  | { type: 'LOCK' }
  | { type: 'GET_ENTRIES'; payload?: { groupId?: string; search?: string } }
  | { type: 'GET_ENTRY'; payload: { id: string } }
  | { type: 'CREATE_ENTRY'; payload: { entry: Omit<EntryData, 'id' | 'created' | 'modified'> } }
  | { type: 'UPDATE_ENTRY'; payload: { entry: EntryData } }
  | { type: 'DELETE_ENTRY'; payload: { id: string } }
  | { type: 'GET_GROUPS' }
  | { type: 'GENERATE_PASSWORD'; payload?: Partial<GeneratorOptions> }
  | { type: 'COPY_TO_CLIPBOARD'; payload: { text: string } }
  | { type: 'EXPORT_DATABASE' }
  | { type: 'DELETE_DATABASE' }
  | { type: 'GET_ENTRIES_FOR_URL'; payload: { url: string } }
  | { type: 'FILL_IN_TAB'; payload: { tabId: number; username: string; password: string } }
  | { type: 'GET_BACKUP_HISTORY'; payload?: { limit?: number } }
  | { type: 'RESTORE_FROM_BACKUP'; payload: { timestamp: number; password: string } }
  | { type: 'GET_STORAGE_HEALTH' }
  | { type: 'GET_RECOVERY_STATUS' }
  | { type: 'GET_ICON' };

// ── Response types ─────────────────────────────────────────────

export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

export type StateResponse = MessageResponse<AppState>;

export type EntriesResponse = MessageResponse<EntryData[]>;

export type EntryResponse = MessageResponse<EntryData>;

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

export type RecoveryStatusResponse = MessageResponse<{
    hasRecoveryCodes: boolean;
    remainingCodes: number;
    codesGenerated: number;
}>;

// ── Constants ──────────────────────────────────────────────────

/** Error code returned when the service worker restarted and DB is no longer in memory */
export const NOT_UNLOCKED_ERROR = 'NOT_UNLOCKED';

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
      console.log(`[sendMessage] attempt ${attempt + 1} for ${message.type}`);
      const response = await Promise.race([
        browser.runtime.sendMessage(message) as Promise<MessageResponse>,
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), MESSAGE_TIMEOUT_MS),
        ),
      ]);
      if (response !== undefined && response !== null) {
        console.log(`[sendMessage] got response for ${message.type}:`, response);
        return response as T;
      }
      console.warn(`[sendMessage] attempt ${attempt + 1}: got undefined/null response`);
    } catch (err) {
      console.warn(`[sendMessage] attempt ${attempt + 1} failed:`, err);
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  console.error(`[sendMessage] all retries exhausted for ${message.type}`);
  return { success: false, error: 'Background service not available' } as T;
}
