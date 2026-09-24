import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createEntry, getEntriesForUrl, updateEntry } from '@/lib/kdbx';

describe('autofill entry settings', () => {
  beforeEach(async () => {
    await createDatabase('Test vault', 'test-password');
  });

  it('defaults Auto Fill on and Auto Login off for existing-style entries', () => {
    createEntry({
      title: 'Example',
      username: 'alice',
      password: 'secret',
      url: 'example.com',
      notes: '',
      tags: [],
      groupId: '',
    });

    expect(getEntriesForUrl('https://example.com/login')[0]).toMatchObject({
      autoFill: true,
      autoLogin: false,
    });
  });

  it('offers only Auto Fill-enabled records for the exact domain', () => {
    createEntry({
      title: 'Disabled',
      username: 'disabled-user',
      password: 'disabled-secret',
      url: 'example.com',
      notes: '',
      tags: [],
      groupId: '',
      autoFill: false,
    });
    createEntry({
      title: 'Enabled',
      username: 'enabled-user',
      password: 'enabled-secret',
      url: 'example.com',
      notes: '',
      tags: [],
      groupId: '',
    });

    expect(getEntriesForUrl('https://example.com/login').map((entry) => entry.title)).toEqual(['Enabled']);
    expect(getEntriesForUrl('https://sub.example.com/login')).toEqual([]);
  });

  it('persists Auto Login when an entry is edited', () => {
    const entry = createEntry({
      title: 'Example',
      username: 'alice',
      password: 'secret',
      url: 'example.com',
      notes: '',
      tags: [],
      groupId: '',
    });

    expect(updateEntry({ ...entry, autoLogin: true })).toMatchObject({ autoLogin: true });
    expect(getEntriesForUrl('https://example.com')[0].autoLogin).toBe(true);
  });
});
