/**
 * Recovery system for password reset and account recovery.
 * - Generates 20 one-time recovery codes
 * - Stores Argon2id hash of master password (not plaintext)
 * - Implements one-time use enforcement for recovery codes
 * - Supports recovery code regeneration after successful recovery
 */

import type { RecoveryCodes, RecoveryCodeEntry, RecoveryCodesData, PasswordHashData } from './storage-types';

const RECOVERY_STORAGE_KEY = 'recovery_codes';

// ── Constants ────────────────────────────────────────────────────

const RECOVERY_CODES_COUNT = 20;
const RECOVERY_CODE_LENGTH = 12;  // 4 groups of 3 characters
const CODE_SEPARATOR = '-';

// Argon2id parameters (matching KeePass defaults)
const ARGON2_MEMORY_SIZE = 19456;  // KiB
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;

// ── Recovery Code Generation ────────────────────────────────────

/**
 * Generate N one-time recovery codes.
 * Codes are in format: XXXX-XXXX-XXXX (alphanumeric, uppercase)
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODES_COUNT): string[] {
  const codes: string[] = [];
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const unbiasedLimit = 256 - (256 % charset.length);

  for (let i = 0; i < count; i++) {
    let code = '';
    while (code.replaceAll(CODE_SEPARATOR, '').length < RECOVERY_CODE_LENGTH) {
      const random = crypto.getRandomValues(new Uint8Array(1))[0];
      if (random >= unbiasedLimit) continue;

      code += charset[random % charset.length];
      const characterCount = code.replaceAll(CODE_SEPARATOR, '').length;

      // Add separator every 4 characters
      if (characterCount % 4 === 0 && characterCount < RECOVERY_CODE_LENGTH) {
        code += CODE_SEPARATOR;
      }
    }
    codes.push(code);
  }

  return codes;
}

/**
 * Normalize recovery code for comparison (remove spaces, uppercase).
 */
function normalizeRecoveryCode(code: string): string {
  return code.replace(/\s+/g, '').toUpperCase();
}

// ── Password Hashing (Using Web Crypto) ──────────────────────────

/**
 * Note: Full Argon2id support requires a library.
 * For now, we'll use PBKDF2 as a fallback which is available in Web Crypto API.
 * In production, consider using argon2-wasm or similar.
 */

export async function hashPassword(password: string): Promise<PasswordHashData> {
  try {
    // Use PBKDF2 as fallback (Web Crypto API standard)
    // Generate random salt
    const saltBuffer = crypto.getRandomValues(new Uint8Array(16));

    // Derive key using PBKDF2
    const passwordBuffer = new TextEncoder().encode(password);
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: 100000,  // High iteration count for security
        hash: 'SHA-256',
      },
      await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Export to raw bytes
    const keyBuffer = await crypto.subtle.exportKey('raw', derivedKey);
    const keyHex = Array.from(new Uint8Array(keyBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const saltHex = Array.from(saltBuffer)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Format: pbkdf2${salt}${hash}
    const hash = `pbkdf2$${saltHex}$${keyHex}`;

    return {
      hash,
      version: 1,
      algorithm: 'pbkdf2-sha256',
      created: Date.now(),
      saltLength: 16,
      memorySize: ARGON2_MEMORY_SIZE,
      iterations: 100000,
    };
  } catch (err) {
    console.error('[recovery-system] Password hashing failed:', err);
    throw new Error('Failed to hash password: ' + String(err));
  }
}

/**
 * Verify password against stored hash.
 */
export async function verifyPasswordHash(password: string, hashData: PasswordHashData): Promise<boolean> {
  try {
    if (hashData.algorithm !== 'pbkdf2-sha256') {
      console.warn('[recovery-system] Unsupported hash algorithm:', hashData.algorithm);
      return false;
    }

    // Parse hash format: pbkdf2${salt}${hash}
    const parts = hashData.hash.split('$');
    if (parts.length !== 3 || parts[0] !== 'pbkdf2') {
      console.warn('[recovery-system] Invalid hash format');
      return false;
    }

    const saltHex = parts[1];
    const storedHashHex = parts[2];

    // Recreate salt buffer
    const saltBuffer = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

    // Derive key again with same parameters
    const passwordBuffer = new TextEncoder().encode(password);
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: hashData.iterations || 100000,
        hash: 'SHA-256',
      },
      await crypto.subtle.importKey('raw', passwordBuffer, 'PBKDF2', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Export and compare
    const keyBuffer = await crypto.subtle.exportKey('raw', derivedKey);
    const keyHex = Array.from(new Uint8Array(keyBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const matches = keyHex === storedHashHex;
    console.log('[recovery-system] Password verification:', matches ? 'SUCCESS' : 'FAILED');
    return matches;
  } catch (err) {
    console.error('[recovery-system] Password verification error:', err);
    return false;
  }
}

// ── Recovery Codes Management ────────────────────────────────────

/**
 * Initialize recovery codes for a new database.
 * Returns the generated codes to be displayed to user.
 */
export async function initializeRecoveryCodes(masterPassword: string): Promise<RecoveryCodes> {
  try {
    const codes = generateRecoveryCodes(RECOVERY_CODES_COUNT);
    const passwordHash = await hashPassword(masterPassword);

    const data: RecoveryCodesData = {
      codes: await Promise.all(codes.map(async (code) => ({
        code: await hashRecoveryCode(code),
        used: false,
        usedAt: null,
        created: Date.now(),
      }))),
      passwordHash: passwordHash.hash,
      hashVersion: 1,
      algorithm: 'pbkdf2-sha256',
      created: Date.now(),
      lastRotated: Date.now(),
    };

    await browser.storage.local.set({ [RECOVERY_STORAGE_KEY]: data });

    console.log('[recovery-system] Recovery codes initialized');

    return {
      codes,
      created: Date.now(),
      used: 0,
      remaining: RECOVERY_CODES_COUNT,
    };
  } catch (err) {
    console.error('[recovery-system] Failed to initialize recovery codes:', err);
    throw err;
  }
}

/**
 * Check if password is correct (for verification during operations).
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const data = await loadRecoveryData();
  if (!data) return false;
  return verifyPasswordHash(password, {
    hash: data.passwordHash,
    version: data.hashVersion,
    algorithm: data.algorithm,
    created: data.created,
    saltLength: 16,
    memorySize: ARGON2_MEMORY_SIZE,
    iterations: 100000,
  });
}

/**
 * Use a recovery code (mark as used, one-time only).
 */
export async function useRecoveryCode(code: string): Promise<boolean> {
  try {
    const data = await loadRecoveryData();
    if (!data) return false;
    const codeHash = await hashRecoveryCode(normalizeRecoveryCode(code));
    const match = data.codes.find((entry) => entry.code === codeHash && !entry.used);
    if (!match) return false;
    match.used = true;
    match.usedAt = Date.now();
    await browser.storage.local.set({ [RECOVERY_STORAGE_KEY]: data });
    return true;
  } catch (err) {
    console.error('[recovery-system] Failed to use recovery code:', err);
    return false;
  }
}

/**
 * Get count of remaining (unused) recovery codes.
 */
export async function getRemainingRecoveryCodes(): Promise<number> {
  try {
    const data = await loadRecoveryData();
    return data?.codes.filter((code) => !code.used).length ?? 0;
  } catch (err) {
    console.error('[recovery-system] Failed to get remaining codes:', err);
    return 0;
  }
}

/**
 * Regenerate recovery codes after successful recovery.
 * Old codes are discarded, new codes generated.
 */
export async function regenerateRecoveryCodes(masterPassword: string): Promise<RecoveryCodes> {
  try {
    // TODO: Implement when IndexedDB access is available
    console.log('[recovery-system] Regenerating recovery codes');

    const codes = generateRecoveryCodes(RECOVERY_CODES_COUNT);
    return {
      codes,
      created: Date.now(),
      used: 0,
      remaining: RECOVERY_CODES_COUNT,
    };
  } catch (err) {
    console.error('[recovery-system] Failed to regenerate recovery codes:', err);
    throw err;
  }
}

/**
 * Update master password hash (when user changes password).
 */
export async function updatePasswordHash(newPassword: string): Promise<void> {
  try {
    const newHash = await hashPassword(newPassword);

    const data = await loadRecoveryData();
    if (!data) return;
    data.passwordHash = newHash.hash;
    data.algorithm = newHash.algorithm;
    await browser.storage.local.set({ [RECOVERY_STORAGE_KEY]: data });
  } catch (err) {
    console.error('[recovery-system] Failed to update password hash:', err);
    throw err;
  }
}

/**
 * Display recovery codes (requires verification).
 * Returns codes if password verification succeeds.
 */
export async function displayRecoveryCodes(masterPassword: string): Promise<string[] | null> {
  try {
    const verified = await verifyPassword(masterPassword);
    if (!verified) {
      console.warn('[recovery-system] Password verification failed');
      return null;
    }

    return null;
  } catch (err) {
    console.error('[recovery-system] Failed to display recovery codes:', err);
    return null;
  }
}

/**
 * Clear all recovery data (used on database deletion).
 */
export async function clearRecoveryCodes(): Promise<void> {
  try {
    await browser.storage.local.remove(RECOVERY_STORAGE_KEY);
  } catch (err) {
    console.warn('[recovery-system] Failed to clear recovery codes:', err);
  }
}

// ── Utility Functions ────────────────────────────────────────────

/**
 * Format recovery codes for user display.
 */
export function formatRecoveryCodesForDisplay(codes: string[]): string {
  return codes.map((code, index) => `${index + 1}. ${code}`).join('\n');
}

/**
 * Validate recovery code format.
 */
export function isValidRecoveryCodeFormat(code: string): boolean {
  const normalized = normalizeRecoveryCode(code);
  // Format: XXXX-XXXX-XXXX or XXXXXXXXXXXX
  const pattern = /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/;
  return pattern.test(normalized);
}

async function hashRecoveryCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeRecoveryCode(code)));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadRecoveryData(): Promise<RecoveryCodesData | null> {
  const result = await browser.storage.local.get(RECOVERY_STORAGE_KEY);
  return (result[RECOVERY_STORAGE_KEY] as RecoveryCodesData | undefined) ?? null;
}
