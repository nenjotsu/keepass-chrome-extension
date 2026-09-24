import { describe, expect, it, vi } from 'vitest';
import { generateRecoveryCodes } from '@/lib/recovery-system';

const local = new Map<string, unknown>();
vi.stubGlobal('browser', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: local.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        Object.entries(values).forEach(([key, value]) => local.set(key, value));
      }),
      remove: vi.fn(async (key: string) => local.delete(key)),
    },
  },
});

describe('recovery codes', () => {
  it('uses Web Crypto rather than Math.random to generate codes', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const getRandomValuesSpy = vi.spyOn(crypto, 'getRandomValues');

    const codes = generateRecoveryCodes(2);

    expect(codes).toHaveLength(2);
    expect(codes.every((code) => /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/.test(code))).toBe(true);
    expect(getRandomValuesSpy).toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('persists only hashed codes and rejects a reused code', async () => {
    local.clear();
    const recovery = await import('@/lib/recovery-system');
    const { codes } = await recovery.initializeRecoveryCodes('master-password');

    expect(await recovery.useRecoveryCode(codes[0])).toBe(true);
    expect(await recovery.useRecoveryCode(codes[0])).toBe(false);
    expect(await recovery.getRemainingRecoveryCodes()).toBe(19);
    expect(JSON.stringify(local.get('recovery_codes'))).not.toContain(codes[0]);
  });
});
