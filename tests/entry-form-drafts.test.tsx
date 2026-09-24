import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryForm } from '@/entrypoints/popup/pages/EntryForm';

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

describe('entry edit drafts', () => {
  beforeEach(() => session.clear());

  it('keeps the saved entry password when restoring a non-secret draft', async () => {
    session.set('draft_entryForm_edit_entry-1', {
      title: 'Work Mail (updated title)',
      username: 'alice@example.com',
      url: 'mail.example.com',
      notes: '',
      tags: '',
    });

    render(
      <EntryForm
        entry={{
          id: 'entry-1',
          title: 'Work Mail',
          username: 'alice@example.com',
          password: 'saved-vault-password',
          url: 'mail.example.com',
          notes: '',
          tags: [],
          groupId: '',
          created: '',
          modified: '',
        }}
        onSaved={() => {}}
        onCancel={() => {}}
        onSessionLost={() => false}
      />,
    );

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Password') as HTMLInputElement).value)
        .toBe('saved-vault-password');
    });
  });
});
