import type { EntryData } from './types';
import { calculateStrength } from './password-generator';

export interface PasswordAuditResult {
  id: string;
  title: string;
  modified: string;
  breached?: boolean;
  strength?: number;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function sha1(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return toHex(await crypto.subtle.digest('SHA-1', bytes));
}

async function fetchHashRange(prefix: string): Promise<Set<string>> {
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Breach lookup failed (${response.status})`);
  const body = await response.text();
  return new Set(body.split(/\r?\n/).flatMap((line) => {
    const [suffix, count] = line.split(':', 2);
    return suffix && Number(count) > 0 ? [suffix.trim().toUpperCase()] : [];
  }));
}

/** Check distinct passwords with HIBP's k-anonymity range endpoint. */
export async function checkBreachedPasswords(entries: EntryData[]): Promise<PasswordAuditResult[]> {
  const rangeCache = new Map<string, Promise<Set<string>>>();
  const passwordCache = new Map<string, Promise<boolean>>();
  const checkOne = (password: string): Promise<boolean> => {
    const existing = passwordCache.get(password);
    if (existing) return existing;
    const check = (async () => {
      const digest = await sha1(password);
      const prefix = digest.slice(0, 5);
      let range = rangeCache.get(prefix);
      if (!range) {
        range = fetchHashRange(prefix);
        rangeCache.set(prefix, range);
      }
      return (await range).has(digest.slice(5));
    })();
    passwordCache.set(password, check);
    return check;
  };

  const passwords = [...new Set(entries.map((entry) => entry.password).filter(Boolean))];
  const outcomes: Array<readonly [string, boolean]> = [];
  let nextPassword = 0;
  let stopWorkers = false;
  const worker = async () => {
    while (!stopWorkers && nextPassword < passwords.length) {
      const password = passwords[nextPassword++];
      try {
        outcomes.push([password, await checkOne(password)]);
      } catch (error) {
        stopWorkers = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, passwords.length) }, () => worker()));
  const breachedByPassword = new Map(outcomes);
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title || entry.url || 'Untitled',
    modified: entry.modified,
    breached: Boolean(entry.password && breachedByPassword.get(entry.password)),
  }));
}

export function findWeakPasswords(entries: EntryData[]): PasswordAuditResult[] {
  return entries.flatMap((entry) => {
    const strength = calculateStrength(entry.password);
    return entry.password && strength <= 1
      ? [{ id: entry.id, title: entry.title || entry.url || 'Untitled', modified: entry.modified, strength }]
      : [];
  });
}
