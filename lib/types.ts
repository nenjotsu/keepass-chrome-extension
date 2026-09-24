/** Represents a simplified entry from the kdbx database for UI display */
export interface EntryData {
  /** Login credentials are the default for existing KeePass entries. */
  kind?: 'login' | 'secure_note';
  id: string;
  title: string;
  username: string;
  password: string;
  /** Optional Base32 TOTP seed. Stored as a protected KDBX field. */
  totpSecret?: string;
  url: string;
  notes: string;
  tags: string[];
  groupId: string;
  created: string;
  modified: string;
  /** Stored as a namespaced custom KDBX field so it travels with the vault. */
  favorite?: boolean;
  /** Defaults to true for entries created before and after this setting was added. */
  autoFill?: boolean;
  /** Legacy KeePass metadata. Automatic form submission is no longer supported. */
  autoLogin?: boolean;
}

export interface SaveMatchData {
  id: string;
  title: string;
  username: string;
  url: string;
}

export interface PendingCredentialData {
  title: string;
  username: string;
  password: string;
  url: string;
}

/** Represents a group/folder in the database */
export interface GroupData {
  id: string;
  name: string;
  parentId: string | null;
  icon: number;
}

/** Database metadata stored alongside the encrypted blob */
export interface DatabaseMeta {
  name: string;
  lastModified: string;
  entryCount: number;
}

/** Application state */
export type AppState =
  | { status: 'no_database' }
  | { status: 'locked'; meta: DatabaseMeta }
  | { status: 'unlocked'; meta: DatabaseMeta };

/** Password generator options */
export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  special: boolean;
  excludeAmbiguous: boolean;
}
