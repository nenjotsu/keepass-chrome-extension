import {
  DEFAULT_REMEMBER_UNLOCK_MS,
  REMEMBER_UNLOCK_OPTIONS,
  STORAGE_KEY_REMEMBER_UNLOCK_PREFERENCE,
} from './constants';

/**
 * Form draft persistence for popup context.
 * Saves form fields to chrome.storage.session so they survive popup close.
 * Session storage is cleared when the browser quits.
 */

const KEY_CREATE_VAULT = 'draft_createVault';
const KEY_UNLOCK = 'draft_unlock';
const KEY_ENTRY_FORM = 'draft_entryForm';

// ── CreateVault ───────────────────────────────────────────────

export interface CreateVaultDraft {
  name: string;
  password: string;
  confirmPassword: string;
  mode: 'create' | 'import';
}

export async function loadCreateVaultDraft(): Promise<CreateVaultDraft | null> {
  try {
    const r = await browser.storage.session.get(KEY_CREATE_VAULT);
    const d = r[KEY_CREATE_VAULT] as Record<string, unknown> | undefined;
    if (!d || typeof d !== 'object') return null;
    return {
      name: String(d.name ?? ''),
      password: String(d.password ?? ''),
      confirmPassword: String(d.confirmPassword ?? ''),
      mode: d.mode === 'import' ? 'import' : 'create',
    };
  } catch {
    return null;
  }
}

export async function saveCreateVaultDraft(draft: CreateVaultDraft): Promise<void> {
  try {
    await browser.storage.session.set({ [KEY_CREATE_VAULT]: draft });
  } catch {
    // ignore
  }
}

export async function clearCreateVaultDraft(): Promise<void> {
  try {
    await browser.storage.session.remove(KEY_CREATE_VAULT);
  } catch {
    // ignore
  }
}

// ── Unlock ─────────────────────────────────────────────────────

export async function loadRememberUnlockDuration(): Promise<number> {
  try {
    const r = await browser.storage.local.get(STORAGE_KEY_REMEMBER_UNLOCK_PREFERENCE);
    const duration = r[STORAGE_KEY_REMEMBER_UNLOCK_PREFERENCE];
    return typeof duration === 'number' && REMEMBER_UNLOCK_OPTIONS.some((o) => o.value === duration)
      ? duration
      : DEFAULT_REMEMBER_UNLOCK_MS;
  } catch {
    return DEFAULT_REMEMBER_UNLOCK_MS;
  }
}

export async function saveRememberUnlockDuration(durationMs: number): Promise<void> {
  if (!REMEMBER_UNLOCK_OPTIONS.some((option) => option.value === durationMs)) return;
  try {
    await browser.storage.local.set({ [STORAGE_KEY_REMEMBER_UNLOCK_PREFERENCE]: durationMs });
  } catch {
    // ignore
  }
}

/** Remove the legacy password draft without touching the remember preference. */
export async function clearUnlockDraft(): Promise<void> {
  try {
    await browser.storage.session.remove(KEY_UNLOCK);
  } catch {
    // ignore
  }
}

// ── EntryForm (new + edit) ──────────────────────────────────────

export interface EntryFormDraft {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string;
  autoFill: boolean;
  autoLogin: boolean;
}

function entryFormKey(entryId?: string): string {
  return entryId ? `${KEY_ENTRY_FORM}_edit_${entryId}` : `${KEY_ENTRY_FORM}_new`;
}

export async function loadEntryFormDraft(entryId?: string): Promise<EntryFormDraft | null> {
  try {
    const key = entryFormKey(entryId);
    const r = await browser.storage.session.get(key);
    const d = r[key] as Record<string, unknown> | undefined;
    if (!d || typeof d !== 'object') return null;
    return {
      title: String(d.title ?? ''),
      username: String(d.username ?? ''),
      password: String(d.password ?? ''),
      url: String(d.url ?? ''),
      notes: String(d.notes ?? ''),
      tags: String(d.tags ?? ''),
      autoFill: d.autoFill !== false,
      autoLogin: d.autoLogin === true,
    };
  } catch {
    return null;
  }
}

export async function saveEntryFormDraft(
  draft: EntryFormDraft,
  entryId?: string,
): Promise<void> {
  try {
    await browser.storage.session.set({ [entryFormKey(entryId)]: draft });
  } catch {
    // ignore
  }
}

export async function clearEntryFormDraft(entryId?: string): Promise<void> {
  try {
    await browser.storage.session.remove(entryFormKey(entryId));
  } catch {
    // ignore
  }
}
