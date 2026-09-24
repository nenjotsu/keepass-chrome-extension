import type { MessageRequest, MessageResponse, StateResponse, EntriesResponse, EntryResponse, GroupsResponse, GeneratePasswordResponse, ExportResponse, BackupHistoryResponse, StorageHealthResponse } from '@/lib/messages';
import type { AppState, PendingCredentialData } from '@/lib/types';
import {
  ALARM_AUTO_LOCK,
  ALARM_CLIPBOARD_CLEAR,
  DEFAULT_LOCK_TIMEOUT_MINUTES,
  REMEMBER_UNLOCK_OPTIONS,
} from '@/lib/constants';
import { initCryptoEngine } from '@/lib/crypto-setup';
import * as kdbx from '@/lib/kdbx';
import * as storage from '@/lib/storage';
import * as persistentStorage from '@/lib/persistent-storage';
import * as backupSystem from '@/lib/backup-system';
import * as stateJournal from '@/lib/state-journal';
import { generatePassword } from '@/lib/password-generator';
import { clearClipboard } from '@/lib/clipboard';

/** Error code sent when the database is not unlocked (e.g. service worker restarted) */
const NOT_UNLOCKED_ERROR = 'NOT_UNLOCKED';
const RECENT_ENTRY_IDS_KEY = 'recent_entry_ids';
const MAX_RECENT_ENTRIES = 20;

let unlockDurationMs: number | null = null;
let unlockExpiresAt = 0;
const pendingNavigationCredentials = new Map<number, { credentials: PendingCredentialData; expiresAt: number }>();

async function recordRecentEntry(entryId: string | undefined): Promise<void> {
  if (!entryId) return;
  const stored = await browser.storage.local.get(RECENT_ENTRY_IDS_KEY);
  const rawRecentIds = stored[RECENT_ENTRY_IDS_KEY];
  const existing: string[] = Array.isArray(rawRecentIds)
    ? rawRecentIds.filter((id: unknown): id is string => typeof id === 'string')
    : [];
  await browser.storage.local.set({
    [RECENT_ENTRY_IDS_KEY]: [entryId, ...existing.filter((id) => id !== entryId)].slice(0, MAX_RECENT_ENTRIES),
  });
}


// ── Storage Systems Initialization ─────────────────────────────

async function initializeStorageSystems(): Promise<void> {
  try {
    // Remove the unsupported legacy recovery verifier. Master-password
    // recovery is intentionally not provided because it would undermine the
    // vault encryption key.
    await browser.storage.local.remove('recovery_codes');
    // Remove plaintext drafts created by older versions, without clearing an
    // explicitly remembered unlock for the current browser session.
    await storage.clearLegacyUnlockMaterial();
    // Initialize all storage layers (local, IndexedDB, etc.)
    await storage.initializeAllStorageSystems();

    // Initialize state journal (recovers incomplete operations)
    await stateJournal.initializeStateJournal();
    const recovery = await stateJournal.recoverIncompleteOperations();
    if (recovery.incompleteCount > 0) {
      console.warn('Recovered incomplete operations:', recovery.incompleteCount);
      // TODO: Handle incomplete operations (retry or rollback)
    }

    // Initialize backup system (hourly snapshots)
    await backupSystem.initializeBackupSystem();
  } catch (err) {
    console.error('Storage initialization failed:', err);
  }
}

// Storage initialization promise - ensures we wait for storage to be ready
let storageInitialized: Promise<void> | null = null;

export default defineBackground(() => {
  // Initialize Argon2 for kdbxweb before any database operations
  try {
    initCryptoEngine();
  } catch (err) {
    console.error('Failed to initialize crypto engine:', err);
  }

  // Initialize new storage systems (IndexedDB, backup, recovery, journal)
  // Store promise so we can await it before operations that need storage
  storageInitialized = initializeStorageSystems()
    .then(() => {
      console.log('[Background] Storage systems initialized successfully');
    })
    .catch((err) => {
      console.error('Failed to initialize storage systems:', err);
    });

  // ── State helpers ──────────────────────────────────────────

  async function getAppState(): Promise<AppState> {
    if (kdbx.isUnlocked()) {
      return { status: 'unlocked', meta: kdbx.getDatabaseMeta() };
    }

    const meta = await storage.loadDatabaseMeta();
    if (meta) {
      return { status: 'locked', meta };
    }
    return { status: 'no_database' };
  }

  function scheduleAutoLock(expiresAt: number): void {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      void lockDatabase();
      return;
    }
    browser.alarms.create(ALARM_AUTO_LOCK, {
      delayInMinutes: Math.max(0.5, remainingMs / 60_000),
    });
  }

  function resetAutoLockTimer(): void {
    unlockExpiresAt = Date.now() + (unlockDurationMs ?? DEFAULT_LOCK_TIMEOUT_MINUTES * 60_000);
    scheduleAutoLock(unlockExpiresAt);
  }

  async function recordUserActivity(): Promise<void> {
    if (!kdbx.isUnlocked()) return;
    if (unlockDurationMs !== null) {
      const updatedExpiry = await storage.extendRememberedUnlock(unlockDurationMs);
      if (updatedExpiry === null) {
        unlockDurationMs = null;
        await storage.clearRememberedUnlock();
      } else {
        unlockExpiresAt = updatedExpiry;
        scheduleAutoLock(unlockExpiresAt);
        return;
      }
    }
    resetAutoLockTimer();
  }

  async function lockDatabase(): Promise<void> {
    kdbx.closeDatabase();
    pendingNavigationCredentials.clear();
    unlockDurationMs = null;
    unlockExpiresAt = 0;
    await storage.clearSessionSecrets();
    await browser.alarms.clear(ALARM_AUTO_LOCK);
  }

  /** Reopen the vault after a service-worker restart only when opted in. */
  async function ensureDatabaseUnlocked(): Promise<boolean> {
    if (kdbx.isUnlocked()) {
      if (unlockExpiresAt > 0 && unlockExpiresAt <= Date.now()) {
        await lockDatabase();
        return false;
      }
      return true;
    }

    const remembered = await storage.loadRememberedUnlock();
    if (!remembered) return false;
    const dbData = await persistentStorage.loadDatabase();
    if (!dbData) {
      await storage.clearSessionSecrets();
      return false;
    }

    try {
      await kdbx.openDatabase(dbData.blob, remembered.password);
      unlockDurationMs = remembered.durationMs;
      unlockExpiresAt = remembered.expiresAt;
      scheduleAutoLock(unlockExpiresAt);
      return true;
    } catch (err) {
      console.warn('[Background] Remembered unlock could not open the current vault; clearing it.', err);
      await lockDatabase();
      return false;
    }
  }

  /** Guard: ensure database is unlocked before data operations */
  async function requireUnlocked(): Promise<MessageResponse | null> {
    if (!(await ensureDatabaseUnlocked())) {
      return { success: false, error: NOT_UNLOCKED_ERROR };
    }
    await recordUserActivity();
    return null;
  }

  /** Save current database state to persistent storage */
  async function persistDatabase(): Promise<void> {
    const op = await stateJournal.beginOperation('database_save', {});

    try {
      const data = await kdbx.saveDatabase();
      const meta = kdbx.getDatabaseMeta();

      // Record edit for backup system
      backupSystem.recordEdit();

      // Check if edit threshold reached for snapshot
      if (backupSystem.shouldCreateEditThresholdSnapshot()) {
        await backupSystem.createSnapshot(data, meta, 'edit_threshold');
      }
      if (backupSystem.shouldCreateHourlySnapshot()) {
        await backupSystem.createSnapshot(data, meta, 'hourly');
      }

      // Save to dual storage (chrome.storage.local + IndexedDB)
      const result = await persistentStorage.persistDatabase(data, meta, 'edit');

      if (!result.success) {
        throw new Error(`Storage sync failed: ${result.error}`);
      }

      // Calculate checksum for journal
      const checksum = await persistentStorage.calculateChecksum(data);
      await stateJournal.completeOperation(op, checksum);
    } catch (err) {
      await stateJournal.rollbackOperation(op, String(err));
      throw err;
    }
  }

  // ── Alarm handler ──────────────────────────────────────────

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_AUTO_LOCK) {
      void (async () => {
        if (kdbx.isUnlocked() && unlockExpiresAt > Date.now()) {
          scheduleAutoLock(unlockExpiresAt);
          return;
        }
        if (!kdbx.isUnlocked()) {
          const remembered = await storage.loadRememberedUnlock();
          if (remembered) {
            scheduleAutoLock(remembered.expiresAt);
            return;
          }
        }
        await lockDatabase();
      })();
    }
    if (alarm.name === ALARM_CLIPBOARD_CLEAR) {
      clearClipboard();
    }
  });

  browser.permissions.onRemoved.addListener((removed) => {
    const removedOrigins = new Set(removed.origins ?? []);
    if (removedOrigins.size === 0) return;
    void browser.scripting.getRegisteredContentScripts().then((scripts) => {
      const ids = scripts
        .filter((script) => script.matches?.some((match) => removedOrigins.has(match)))
        .map((script) => script.id);
      if (ids.length) return browser.scripting.unregisterContentScripts({ ids });
    }).catch(() => {});
  });

  // ── Message handler ────────────────────────────────────────

  browser.runtime.onMessage.addListener((message: MessageRequest, sender) =>
    handleMessage(message, sender).catch((err): MessageResponse => {
      console.error('Message handler error:', err);
      return { success: false, error: String(err) };
    }),
  );

  async function handleMessage(msg: MessageRequest, sender?: { tab?: { id?: number }; url?: string }): Promise<MessageResponse> {
    try {
      // Ensure storage is initialized before processing messages
      if (storageInitialized) {
        await storageInitialized;
      }

      switch (msg.type) {
        case 'GET_STATE': {
          if (await ensureDatabaseUnlocked()) await recordUserActivity();
          const state = await getAppState();
          return { success: true, data: state } as StateResponse;
        }

        case 'CREATE_DATABASE': {
          const op = await stateJournal.beginOperation('create_database', { name: msg.payload.name });
          try {
            const { name, password } = msg.payload;
            await storage.clearSessionSecrets();
            unlockDurationMs = null;
            await kdbx.createDatabase(name, password);
            await persistDatabase();

            // The master password is intentionally not recoverable. Remove any
            // orphaned recovery metadata from older builds.
            await browser.storage.local.remove('recovery_codes');

            resetAutoLockTimer();
            await stateJournal.completeOperation(op, '');

            // Return recovery codes to user
            return {
              success: true,
              data: {
                appState: await getAppState(),
              },
            } as unknown as StateResponse;
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'IMPORT_DATABASE': {
          const op = await stateJournal.beginOperation('import_database', { dataSize: msg.payload.data.length });
          try {
            const { data, password } = msg.payload;
            const arr = new Uint8Array(data);
            const buffer = arr.buffer;
            try {
              await kdbx.openDatabase(buffer, password);
            } catch (err) {
              console.error('[bg] IMPORT_DATABASE openDatabase failed:', err);
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes('InvalidKey')) {
                return { success: false, error: 'Wrong master password.' };
              }
              throw err;
            }
            await storage.clearSessionSecrets();
            unlockDurationMs = null;
            await persistDatabase();

            await browser.storage.local.remove('recovery_codes');

            resetAutoLockTimer();
            await stateJournal.completeOperation(op, '');

            return {
              success: true,
              data: {
                appState: await getAppState(),
              },
            } as unknown as StateResponse;
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'UNLOCK': {
          const op = await stateJournal.beginOperation('unlock', {});
          try {
            // Load from new persistent storage (dual storage with fallback)
            const dbData = await persistentStorage.loadDatabase();
            if (!dbData) return { success: false, error: 'No database found' };

            try {
              await kdbx.openDatabase(dbData.blob, msg.payload.password);
            } catch (err) {
              console.error('[bg] UNLOCK openDatabase failed:', err);
              const errMsg = err instanceof Error ? err.message : String(err);
              if (errMsg.includes('InvalidKey')) {
                return { success: false, error: 'Wrong password. Try again.' };
              }
              throw err;
            }
            const selectedDuration = REMEMBER_UNLOCK_OPTIONS.some(
              (option) => option.value === msg.payload.rememberDurationMs && option.value > 0,
            ) ? msg.payload.rememberDurationMs : 0;
            if (selectedDuration > 0) {
              await storage.rememberUnlock(msg.payload.password, selectedDuration);
              unlockDurationMs = selectedDuration;
            } else {
              await storage.clearRememberedUnlock();
              unlockDurationMs = null;
            }
            resetAutoLockTimer();
            await stateJournal.completeOperation(op, '');

            return { success: true, data: await getAppState() } as StateResponse;
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'LOCK': {
          await lockDatabase();
          return { success: true, data: null };
        }

        case 'CHANGE_MASTER_PASSWORD': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const { currentPassword, newPassword } = msg.payload;
          if (!newPassword || newPassword.length < 8) return { success: false, error: 'Master password must be at least 8 characters.' };
          if (!(await kdbx.verifyMasterPassword(currentPassword))) return { success: false, error: 'Current master password is incorrect.' };
          const remembered = await storage.loadRememberedUnlock();
          await kdbx.changeMasterPassword(newPassword);
          await persistDatabase();
          // Old snapshots are encrypted with the old master password. Replace
          // them so restore continues to work using the current credential.
          await persistentStorage.clearDatabaseVersions();
          await backupSystem.clearBackupHistory();
          const freshBackupCreated = await backupSystem.createSnapshot(
            await kdbx.saveDatabase(), kdbx.getDatabaseMeta(), 'manual',
          );
          if (remembered) await storage.rememberUnlock(newPassword, remembered.durationMs);
          return { success: true, data: { freshBackupCreated } };
        }

        case 'SESSION_ACTIVITY': {
          if (await ensureDatabaseUnlocked()) await recordUserActivity();
          return { success: true, data: null };
        }

        case 'GET_ENTRIES': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const entries = kdbx.getEntries(
            msg.payload?.groupId,
            msg.payload?.search,
          );
          return { success: true, data: entries } as EntriesResponse;
        }

        case 'GET_BREACHED_ENTRY_IDS': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const stored = await browser.storage.local.get('breachedEntryStates');
          const states = stored.breachedEntryStates && typeof stored.breachedEntryStates === 'object'
            ? stored.breachedEntryStates as Record<string, string>
            : {};
          const current = new Map(kdbx.getEntries().map((entry) => [entry.id, entry.modified]));
          const validIds = Object.keys(states).filter((id) => current.get(id) === states[id]);
          if (validIds.length !== Object.keys(states).length) {
            await browser.storage.local.set({
              breachedEntryStates: Object.fromEntries(validIds.map((id) => [id, states[id]])),
            });
          }
          return { success: true, data: validIds };
        }

        case 'SAVE_BREACH_RESULTS': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const stored = await browser.storage.local.get('breachedEntryStates');
          const states = stored.breachedEntryStates && typeof stored.breachedEntryStates === 'object'
            ? { ...stored.breachedEntryStates as Record<string, string> }
            : {};
          for (const result of msg.payload.results) {
            const entry = kdbx.getEntry(result.id);
            if (!entry || entry.modified !== result.modified) continue;
            if (result.breached) states[result.id] = result.modified;
            else delete states[result.id];
          }
          await browser.storage.local.set({ breachedEntryStates: states });
          return { success: true, data: Object.keys(states) };
        }

        case 'GET_RECENT_ENTRY_IDS': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const stored = await browser.storage.local.get(RECENT_ENTRY_IDS_KEY);
          const rawRecentIds = stored[RECENT_ENTRY_IDS_KEY];
          const ids: string[] = Array.isArray(rawRecentIds)
            ? rawRecentIds.filter((id: unknown): id is string => typeof id === 'string')
            : [];
          const availableIds = new Set(kdbx.getEntries().map((entry) => entry.id));
          const currentIds = ids.filter((id) => availableIds.has(id));
          if (currentIds.length !== ids.length) {
            await browser.storage.local.set({ [RECENT_ENTRY_IDS_KEY]: currentIds });
          }
          return { success: true, data: currentIds };
        }

        case 'GET_ENTRY': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const entry = kdbx.getEntry(msg.payload.id);
          if (!entry) return { success: false, error: 'Entry not found' };
          return { success: true, data: entry } as EntryResponse;
        }

        case 'CREATE_ENTRY': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const created = kdbx.createEntry(msg.payload.entry);
          await persistDatabase();
          return { success: true, data: created } as EntryResponse;
        }

        case 'IMPORT_CSV_ENTRIES': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const op = await stateJournal.beginOperation('import_csv_entries', { count: msg.payload.entries.length });
          try {
            const created = msg.payload.entries.map((entry) => kdbx.createEntry(entry));
            await persistDatabase();
            await stateJournal.completeOperation(op, '');
            return { success: true, data: created };
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'UNDO_CSV_IMPORT': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const op = await stateJournal.beginOperation('undo_csv_import', { count: msg.payload.ids.length });
          try {
            for (const id of msg.payload.ids) kdbx.deleteEntry(id);
            await persistDatabase();
            await stateJournal.completeOperation(op, '');
            return { success: true, data: null };
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'UPDATE_ENTRY': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const updated = kdbx.updateEntry(msg.payload.entry);
          if (!updated) return { success: false, error: 'Entry not found' };
          await persistDatabase();
          return { success: true, data: updated } as EntryResponse;
        }

        case 'UPDATE_ENTRY_PASSWORD': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const updated = kdbx.updateEntryCredentials(msg.payload.id, {
            title: msg.payload.title,
            url: msg.payload.url,
            username: msg.payload.username,
            password: msg.payload.password,
          });
          if (!updated) return { success: false, error: 'Entry not found' };
          await persistDatabase();
          return { success: true, data: null };
        }

        case 'DELETE_ENTRY': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          if (!(await kdbx.verifyMasterPassword(msg.payload.password))) {
            return { success: false, error: 'INVALID_MASTER_PASSWORD' };
          }
          const deleted = kdbx.deleteEntry(msg.payload.id);
          if (!deleted) return { success: false, error: 'Entry not found' };
          await persistDatabase();
          return { success: true, data: null };
        }

        case 'GET_GROUPS': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const groups = kdbx.getGroups();
          return { success: true, data: groups } as GroupsResponse;
        }

        case 'CREATE_GROUP': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const group = kdbx.createGroup(msg.payload.name);
          await persistDatabase();
          return { success: true, data: group };
        }

        case 'RENAME_GROUP': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          if (!kdbx.renameGroup(msg.payload.id, msg.payload.name)) return { success: false, error: 'Folder not found' };
          await persistDatabase();
          return { success: true, data: null };
        }

        case 'DELETE_GROUP': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          if (!kdbx.deleteGroup(msg.payload.id)) return { success: false, error: 'Folder not found' };
          await persistDatabase();
          return { success: true, data: null };
        }

        case 'MOVE_ENTRIES': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const moved = kdbx.moveEntries(msg.payload.ids, msg.payload.groupId);
          await persistDatabase();
          return { success: true, data: moved };
        }

        case 'GENERATE_PASSWORD': {
          if (await ensureDatabaseUnlocked()) await recordUserActivity();
          const pw = generatePassword(msg.payload);
          return { success: true, data: pw } as GeneratePasswordResponse;
        }

        case 'COPY_TO_CLIPBOARD': {
          if (await ensureDatabaseUnlocked()) await recordUserActivity();
          await recordRecentEntry(msg.payload.entryId);
          browser.alarms.create(ALARM_CLIPBOARD_CLEAR, {
            delayInMinutes: 15 / 60,
          });
          return { success: true, data: null };
        }

        case 'DELETE_DATABASE': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          if (!(await kdbx.verifyMasterPassword(msg.payload.password))) {
            return { success: false, error: 'INVALID_MASTER_PASSWORD' };
          }
          const op = await stateJournal.beginOperation('delete_database', {});
          try {
            await lockDatabase();

            // Remove from both storage systems
            await persistentStorage.removeDatabaseCompletely();
            await storage.removeDatabaseFromStorage();

            await browser.storage.local.remove('recovery_codes');

            // Clear tokens
            await storage.clearSessionSecrets();

            // Clear backup system state
            backupSystem.cleanup();

            await stateJournal.completeOperation(op, '');
            return { success: true, data: await getAppState() } as StateResponse;
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            throw err;
          }
        }

        case 'EXPORT_DATABASE': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const exportData = await kdbx.saveDatabase();
          const exportArr = Array.from(new Uint8Array(exportData));
          console.log('[Export] Database exported, size:', exportArr.length, 'bytes');
          return { success: true, data: exportArr } as ExportResponse;
        }

        case 'GET_ENTRIES_FOR_URL': {
          if (!(await ensureDatabaseUnlocked())) return { success: true, data: [] } as EntriesResponse;
          const urlEntries = kdbx.getEntriesForUrl(msg.payload.url);
          return { success: true, data: urlEntries } as EntriesResponse;
        }

        case 'GET_SAVE_CREDENTIAL_MATCH': {
          if (!(await ensureDatabaseUnlocked())) return { success: false, error: NOT_UNLOCKED_ERROR };
          await recordUserActivity();
          return { success: true, data: kdbx.findSaveMatch(msg.payload.url, msg.payload.username) };
        }

        case 'STORE_PENDING_CREDENTIALS': {
          const tabId = sender?.tab?.id;
          if (tabId === undefined || !(await ensureDatabaseUnlocked())) return { success: false, error: NOT_UNLOCKED_ERROR };
          await recordUserActivity();
          for (const [id, value] of pendingNavigationCredentials) {
            if (value.expiresAt < Date.now()) pendingNavigationCredentials.delete(id);
          }
          if (pendingNavigationCredentials.size >= 20 && !pendingNavigationCredentials.has(tabId)) {
            const oldestTabId = pendingNavigationCredentials.keys().next().value;
            if (oldestTabId !== undefined) pendingNavigationCredentials.delete(oldestTabId);
          }
          const expiresAt = Date.now() + 10_000;
          pendingNavigationCredentials.set(tabId, { credentials: msg.payload, expiresAt });
          setTimeout(() => {
            if (pendingNavigationCredentials.get(tabId)?.expiresAt === expiresAt) pendingNavigationCredentials.delete(tabId);
          }, 10_000);
          return { success: true, data: null };
        }

        case 'TAKE_PENDING_CREDENTIALS': {
          const tabId = sender?.tab?.id;
          if (tabId === undefined) return { success: true, data: null };
          const pending = pendingNavigationCredentials.get(tabId);
          pendingNavigationCredentials.delete(tabId);
          if (!pending || pending.expiresAt < Date.now() || !(await ensureDatabaseUnlocked())) {
            return { success: true, data: null };
          }
          await recordUserActivity();
          return { success: true, data: pending.credentials };
        }

        case 'GET_ICON': {
          try {
            const url = browser.runtime.getURL('/icon/32.png');
            const response = await fetch(url);
            const blob = await response.blob();
            const reader = new FileReader();
            return new Promise((resolve) => {
              reader.onload = () => {
                const dataUrl = reader.result as string;
                resolve({ success: true, data: dataUrl });
              };
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            console.error('Failed to get icon:', err);
            return { success: false, error: String(err) };
          }
        }

        case 'FILL_IN_TAB': {
          if (!sender?.url?.startsWith(browser.runtime.getURL('/'))) {
            return { success: false, error: 'Fill requests must come from the extension popup.' };
          }
          const guard = await requireUnlocked();
          if (guard) return guard;
          const { tabId, entryId } = msg.payload;
          const entry = kdbx.getEntry(entryId);
          if (!entry || entry.kind === 'secure_note' || entry.autoFill === false) {
            return { success: false, error: 'This entry is not enabled for autofill.' };
          }
          const tab = await browser.tabs.get(tabId);
          if (!tab.url || !kdbx.getEntriesForUrl(tab.url).some((candidate) => candidate.id === entryId)) {
            return { success: false, error: 'This entry does not match the active site.' };
          }
          try {
            await browser.scripting.executeScript({
              target: { tabId },
              func: (user: string, pass: string) => {
                const setNativeValue = (input: HTMLInputElement, value: string) => {
                  const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value',
                  )?.set;
                  if (setter) setter.call(input, value);
                  else input.value = value;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                };
                const pwFields = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
                if (pwFields.length === 0) return;
                const field = pwFields[0];
                const form = field.closest('form');
                const root: ParentNode = form ?? document;
                const candidates = root.querySelectorAll<HTMLInputElement>(
                  'input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[type="email"], input[type="text"]',
                );
                const userField = Array.from(candidates).find((input) => {
                  const type = input.type.toLowerCase();
                  return !input.disabled && !input.readOnly && type !== 'hidden' && type !== 'password';
                });
                if (userField) setNativeValue(userField, user);
                setNativeValue(field, pass);
              },
              args: [entry.username, entry.password],
            });
            await recordRecentEntry(entryId);
            return { success: true, data: null };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        }

        case 'GET_BACKUP_HISTORY': {
          const guard = await requireUnlocked();
          if (guard) return guard;

          const limit = msg.payload?.limit ?? 10;
          const backups = await backupSystem.getBackupHistory(limit);

          return {
            success: true,
            data: {
              backups: backups.map((b) => ({
                timestamp: b.timestamp,
                version: b.version,
                reason: b.reason,
                size: b.metadata?.name ? b.size : 0,
              })),
              totalSize: backups.reduce((sum, b) => sum + b.size, 0),
            },
          } as unknown as BackupHistoryResponse;
        }

        case 'CREATE_BACKUP': {
          const guard = await requireUnlocked();
          if (guard) return guard;
          const created = await backupSystem.createSnapshot(await kdbx.saveDatabase(), kdbx.getDatabaseMeta(), 'manual');
          if (!created) return { success: false, error: 'Could not save the backup. Check available storage and try again.' };
          await backupSystem.pruneBackups();
          return { success: true, data: await backupSystem.getBackupHistory() };
        }

        case 'RESTORE_FROM_BACKUP': {
          const op = await stateJournal.beginOperation('restore_backup', { timestamp: msg.payload.timestamp });
          try {
            const { timestamp, password } = msg.payload;
            const blob = await backupSystem.restoreSnapshot(timestamp);

            await kdbx.openDatabase(blob, password);
            await storage.clearSessionSecrets();
            unlockDurationMs = null;
            await persistDatabase();
            resetAutoLockTimer();
            await stateJournal.completeOperation(op, '');

            return { success: true, data: await getAppState() } as StateResponse;
          } catch (err) {
            await stateJournal.rollbackOperation(op, String(err));
            return { success: false, error: String(err) };
          }
        }

        case 'GET_STORAGE_HEALTH': {
          const health = await persistentStorage.getStorageHealthReport();
          return {
            success: true,
            data: health,
          } as unknown as StorageHealthResponse;
        }

        default:
          return { success: false, error: 'Unknown message type' };
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('Background message error:', error);
      return { success: false, error };
    }
  }
});
