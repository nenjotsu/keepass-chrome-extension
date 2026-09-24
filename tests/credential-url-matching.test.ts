import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createEntry, findSaveMatch, getEntriesForUrl, updateEntry, updateEntryCredentials } from '@/lib/kdbx';

describe('credential URL matching', () => {
  beforeEach(async () => {
    await createDatabase('Test vault', 'test-password');
    createEntry({
      title: 'Example',
      username: 'alice',
      password: 'secret',
      url: 'https://example.com/login',
      notes: '',
      tags: [],
      groupId: '',
    });
  });

  it('does not offer an exact-host credential to an untrusted subdomain', () => {
    expect(getEntriesForUrl('https://evil.example.com/login')).toEqual([]);
    expect(getEntriesForUrl('https://example.com/login')).toHaveLength(1);
  });

  it('persists favorites as entry data', () => {
    const [entry] = getEntriesForUrl('https://example.com/login');
    expect(entry.favorite).toBe(false);

    expect(updateEntry({ ...entry, favorite: true })).toMatchObject({ favorite: true });
    expect(getEntriesForUrl('https://example.com/login')[0].favorite).toBe(true);
  });

  it('matches save offers by exact hostname and case-insensitive username without exposing the password', () => {
    const match = findSaveMatch('https://example.com/signup', 'ALICE');

    expect(match).toMatchObject({ title: 'Example', username: 'alice', url: 'https://example.com/login' });
    expect(match).not.toHaveProperty('password');
    expect(findSaveMatch('https://sub.example.com/', 'alice')).toBeNull();
    expect(findSaveMatch('https://example.com/', 'bob')).toBeNull();
  });

  it('updates submitted credentials while preserving the rest of the entry', () => {
    const [entry] = getEntriesForUrl('https://example.com/login');
    updateEntry({ ...entry, notes: 'keep this note', tags: ['work'], favorite: true });

    const updated = updateEntryCredentials(entry.id, {
      title: 'Example account',
      username: 'alice@example.com',
      password: 'new-secret',
      url: 'https://example.com/',
    });

    expect(updated).toMatchObject({
      title: 'Example account',
      username: 'alice@example.com',
      password: 'new-secret',
      url: 'https://example.com/',
      notes: 'keep this note',
      tags: ['work'],
      favorite: true,
    });
  });
});
