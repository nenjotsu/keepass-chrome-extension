import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = new Map<string, unknown>();

vi.stubGlobal('browser', {
  storage: {
    session: {
      get: vi.fn(async (key: string) => ({ [key]: session.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.entries(values).forEach(([key, value]) => session.set(key, value));
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((key) => session.delete(key));
      }),
    },
  },
});

describe('session secret lifecycle', () => {
  beforeEach(() => session.clear());

  it('clears every legacy unlock secret when the vault locks', async () => {
    const storage = await import('@/lib/storage');
    session.set('session_password', 'master-password');
    session.set('encrypted_unlock_token', 'master-password');

    await storage.clearSessionSecrets();

    expect(session.has('session_password')).toBe(false);
    expect(session.has('encrypted_unlock_token')).toBe(false);
  });
});
