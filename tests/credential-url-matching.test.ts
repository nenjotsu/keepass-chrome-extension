import { beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createEntry, getEntriesForUrl } from '@/lib/kdbx';

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
});
