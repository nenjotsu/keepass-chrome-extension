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

describe('form drafts', () => {
  beforeEach(() => session.clear());

  it('restores create-vault fields without storing either password', async () => {
    const drafts = await import('@/lib/form-drafts');

    await drafts.saveCreateVaultDraft({
      name: 'Personal',
      password: 'master-secret',
      confirmPassword: 'master-secret',
      mode: 'create',
    });

    expect(session.get('draft_createVault')).toEqual({ name: 'Personal', mode: 'create' });
    await expect(drafts.loadCreateVaultDraft()).resolves.toMatchObject({
      name: 'Personal',
      password: '',
      confirmPassword: '',
    });
  });

  it('restores entry details without storing the entry password', async () => {
    const drafts = await import('@/lib/form-drafts');

    await drafts.saveEntryFormDraft({
      title: 'Mail',
      username: 'alice',
      password: 'entry-secret',
      url: 'mail.example.com',
      notes: 'Work account',
      tags: 'work',
      autoFill: true,
    });

    expect(session.get('draft_entryForm_new')).toEqual({
      title: 'Mail',
      username: 'alice',
      url: 'mail.example.com',
      notes: 'Work account',
      tags: 'work',
      autoFill: true,
    });
    await expect(drafts.loadEntryFormDraft()).resolves.toMatchObject({
      title: 'Mail',
      username: 'alice',
      password: '',
    });
  });

  it('removes passwords from legacy drafts when restoring them', async () => {
    const drafts = await import('@/lib/form-drafts');
    session.set('draft_createVault', {
      name: 'Personal',
      password: 'old-master-secret',
      confirmPassword: 'old-master-secret',
      mode: 'create',
    });
    session.set('draft_entryForm_new', {
      title: 'Mail',
      username: 'alice',
      password: 'old-entry-secret',
      url: 'mail.example.com',
      notes: '',
      tags: '',
    });

    await drafts.loadCreateVaultDraft();
    await drafts.loadEntryFormDraft();

    expect(session.get('draft_createVault')).toEqual({ name: 'Personal', mode: 'create' });
    expect(session.get('draft_entryForm_new')).not.toHaveProperty('password');
  });
});
