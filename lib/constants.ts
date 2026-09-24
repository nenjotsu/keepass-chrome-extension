/** Storage key for the encrypted .kdbx database blob */
export const STORAGE_KEY_DB = 'kdbx_database';

/** Storage key for database metadata (name, last modified) */
export const STORAGE_KEY_META = 'kdbx_meta';

/** Default auto-lock timeout in minutes */
export const DEFAULT_LOCK_TIMEOUT_MINUTES = 15;

/** Allowed opt-in durations for retaining an unlock secret in session storage. */
export const REMEMBER_UNLOCK_OPTIONS = [
  { label: "Don't remember (15 minutes)", value: 0 },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '8 hours', value: 8 * 60 * 60 * 1000 },
  { label: '1 day', value: 24 * 60 * 60 * 1000 },
  { label: '1 week', value: 7 * 24 * 60 * 60 * 1000 },
] as const;

export const DEFAULT_REMEMBER_UNLOCK_MS = 0;
export const STORAGE_KEY_REMEMBER_UNLOCK_PREFERENCE = 'remember_unlock_preference';

/** Clipboard auto-clear timeout in seconds */
export const CLIPBOARD_CLEAR_SECONDS = 15;

/** Alarm name for auto-lock */
export const ALARM_AUTO_LOCK = 'auto-lock';

/** Alarm name for clipboard clear */
export const ALARM_CLIPBOARD_CLEAR = 'clipboard-clear';

/** Default password generator settings */
export const DEFAULT_GENERATOR_OPTIONS = {
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  special: true,
  excludeAmbiguous: false,
} as const;
