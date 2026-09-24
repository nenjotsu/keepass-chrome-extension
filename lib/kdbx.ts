import * as kdbxweb from 'kdbxweb';
import type { EntryData, GroupData, DatabaseMeta, SaveMatchData } from './types';

/**
 * Wrapper around kdbxweb for working with .kdbx databases.
 * This is the core data layer — all access to entries/groups goes through here.
 */

let currentDb: kdbxweb.Kdbx | null = null;
const FAVORITE_FIELD = 'KeePassChromeExtension.Favorite';
const AUTO_FILL_FIELD = 'KeePassChromeExtension.AutoFill';
const AUTO_LOGIN_FIELD = 'KeePassChromeExtension.AutoLogin';

// ── Database lifecycle ─────────────────────────────────────────

/** Create a new empty database with a master password */
export async function createDatabase(name: string, password: string): Promise<kdbxweb.Kdbx> {
  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
  );
  await credentials.ready;
  const db = kdbxweb.Kdbx.create(credentials, name);
  currentDb = db;
  return db;
}

/** Open an existing .kdbx database from raw bytes */
export async function openDatabase(
  data: ArrayBuffer,
  password: string,
): Promise<kdbxweb.Kdbx> {
  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(password),
  );
  await credentials.ready;
  const db = await kdbxweb.Kdbx.load(data, credentials);
  currentDb = db;
  return db;
}

/** Save the current database to ArrayBuffer (.kdbx binary) */
export async function saveDatabase(): Promise<ArrayBuffer> {
  if (!currentDb) throw new Error('No database is open');
  return currentDb.save();
}

/** Close / lock the database, clearing it from memory */
export function closeDatabase(): void {
  currentDb = null;
}

/** Check if database is currently unlocked */
export function isUnlocked(): boolean {
  return currentDb !== null;
}

/** Get the underlying kdbx instance (internal use) */
export function getDb(): kdbxweb.Kdbx {
  if (!currentDb) throw new Error('Database is not unlocked');
  return currentDb;
}

// ── Database metadata ──────────────────────────────────────────

export function getDatabaseMeta(): DatabaseMeta {
  const db = getDb();
  let entryCount = 0;
  for (const _entry of db.getDefaultGroup().allEntries()) {
    entryCount++;
  }
  return {
    name: db.meta.name || 'Untitled',
    lastModified: new Date().toISOString(),
    entryCount,
  };
}

// ── Groups ─────────────────────────────────────────────────────

export function getGroups(): GroupData[] {
  const db = getDb();
  const result: GroupData[] = [];

  function collectGroups(group: kdbxweb.KdbxGroup) {
    // Skip recycle bin
    if (
      db.meta.recycleBinUuid &&
      group.uuid.equals(db.meta.recycleBinUuid)
    ) {
      return;
    }

    result.push({
      id: group.uuid.toString(),
      name: group.name || 'Unnamed',
      parentId: group.parentGroup?.uuid.toString() ?? null,
      icon: group.icon ?? 48,
    });

    for (const subGroup of group.groups) {
      collectGroups(subGroup);
    }
  }

  collectGroups(db.getDefaultGroup());
  return result;
}

// ── Entries ─────────────────────────────────────────────────────

/** Safely convert a kdbxweb time value to ISO string */
function timeToIso(time: unknown): string {
  if (time instanceof Date) return time.toISOString();
  if (typeof time === 'number' && time > 0) return new Date(time).toISOString();
  return new Date().toISOString();
}

function kdbxEntryToData(entry: kdbxweb.KdbxEntry): EntryData {
  const getField = (name: string): string => {
    const val = entry.fields.get(name);
    if (!val) return '';
    if (typeof val === 'string') return val;
    // ProtectedValue
    return val.getText();
  };

  return {
    id: entry.uuid.toString(),
    title: getField('Title'),
    username: getField('UserName'),
    password: getField('Password'),
    url: getField('URL'),
    notes: getField('Notes'),
    tags: entry.tags || [],
    groupId: entry.parentGroup?.uuid.toString() ?? '',
    created: timeToIso(entry.times.creationTime),
    modified: timeToIso(entry.times.lastModTime),
    favorite: getField(FAVORITE_FIELD) === 'true',
    autoFill: getField(AUTO_FILL_FIELD) !== 'false',
    autoLogin: getField(AUTO_LOGIN_FIELD) === 'true',
  };
}

/** Get all entries, optionally filtered by group or search query */
export function getEntries(groupId?: string, search?: string): EntryData[] {
  const db = getDb();
  const entries: EntryData[] = [];

  for (const entry of db.getDefaultGroup().allEntries()) {
    // Skip entries in recycle bin
    if (
      db.meta.recycleBinUuid &&
      entry.parentGroup?.uuid.equals(db.meta.recycleBinUuid)
    ) {
      continue;
    }

    const data = kdbxEntryToData(entry);

    // Filter by group
    if (groupId && data.groupId !== groupId) continue;

    // Filter by search
    if (search) {
      const q = search.toLowerCase();
      const matches =
        data.title.toLowerCase().includes(q) ||
        data.username.toLowerCase().includes(q) ||
        data.url.toLowerCase().includes(q) ||
        data.notes.toLowerCase().includes(q) ||
        data.tags.some((t) => t.toLowerCase().includes(q));
      if (!matches) continue;
    }

    entries.push(data);
  }

  return entries;
}

/** Get a single entry by ID */
export function getEntry(id: string): EntryData | null {
  const db = getDb();
  for (const entry of db.getDefaultGroup().allEntries()) {
    if (entry.uuid.toString() === id) {
      return kdbxEntryToData(entry);
    }
  }
  return null;
}

/** Normalize URL or plain hostname (e.g. "italki.com") to hostname */
function toHostname(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  try {
    return new URL(s.startsWith('http') ? s : `https://${s}`).hostname;
  } catch {
    const beforeSlash = s.split('/')[0] || s;
    return beforeSlash;
  }
}

/** Check if entry URL matches page URL (supports "italki.com" without protocol) */
function urlMatches(entryUrl: string, pageHostname: string): boolean {
  const entryHost = toHostname(entryUrl);
  if (!entryHost) return false;
  return pageHostname === entryHost;
}

/** Get entries matching a URL (for autofill) */
export function getEntriesForUrl(url: string): EntryData[] {
  const pageHost = toHostname(url);
  if (!pageHost) return [];
  return getEntries().filter((e) => e.autoFill !== false && e.url && urlMatches(e.url, pageHost));
}

/** Find a same-host, same-username entry without exposing its password. */
export function findSaveMatch(url: string, username: string): SaveMatchData | null {
  const host = toHostname(url);
  const normalizedUsername = username.trim().toLocaleLowerCase();
  if (!host || !normalizedUsername) return null;
  const match = getEntries().find((entry) =>
    toHostname(entry.url) === host && entry.username.trim().toLocaleLowerCase() === normalizedUsername,
  );
  return match ? { id: match.id, title: match.title, username: match.username, url: match.url } : null;
}

/** Create a new entry in a group */
export function createEntry(
  data: Omit<EntryData, 'id' | 'created' | 'modified'>,
): EntryData {
  const db = getDb();

  // Find target group
  let targetGroup = db.getDefaultGroup();
  if (data.groupId) {
    const found = db.getGroup(data.groupId);
    if (found) targetGroup = found;
  }

  const entry = db.createEntry(targetGroup);
  entry.fields.set('Title', data.title);
  entry.fields.set('UserName', data.username);
  entry.fields.set(
    'Password',
    kdbxweb.ProtectedValue.fromString(data.password),
  );
  entry.fields.set('URL', data.url);
  entry.fields.set('Notes', data.notes);
  entry.tags = data.tags || [];
  if (data.favorite) entry.fields.set(FAVORITE_FIELD, 'true');
  if (data.autoFill === false) entry.fields.set(AUTO_FILL_FIELD, 'false');

  return kdbxEntryToData(entry);
}

/** Update an existing entry */
export function updateEntry(data: EntryData): EntryData | null {
  const db = getDb();
  for (const entry of db.getDefaultGroup().allEntries()) {
    if (entry.uuid.toString() === data.id) {
      // Save current state to history
      entry.pushHistory();

      entry.fields.set('Title', data.title);
      entry.fields.set('UserName', data.username);
      entry.fields.set(
        'Password',
        kdbxweb.ProtectedValue.fromString(data.password),
      );
      entry.fields.set('URL', data.url);
      entry.fields.set('Notes', data.notes);
      entry.tags = data.tags || [];
      if (data.favorite) entry.fields.set(FAVORITE_FIELD, 'true');
      else entry.fields.delete(FAVORITE_FIELD);
      if (data.autoFill === false) entry.fields.set(AUTO_FILL_FIELD, 'false');
      else entry.fields.delete(AUTO_FILL_FIELD);
      // Legacy Auto Login metadata is intentionally removed: filling never submits forms.
      entry.fields.delete(AUTO_LOGIN_FIELD);
      entry.times.update();

      return kdbxEntryToData(entry);
    }
  }
  return null;
}

/** Update submitted login details while preserving the rest of a matched entry. */
export function updateEntryCredentials(
  id: string,
  credentials: Pick<EntryData, 'title' | 'url' | 'username' | 'password'>,
): EntryData | null {
  const entry = getEntry(id);
  if (!entry) return null;
  return updateEntry({ ...entry, ...credentials });
}

/** Delete an entry (moves to recycle bin or deletes permanently) */
export function deleteEntry(id: string): boolean {
  const db = getDb();
  for (const entry of db.getDefaultGroup().allEntries()) {
    if (entry.uuid.toString() === id) {
      db.remove(entry);
      return true;
    }
  }
  return false;
}
