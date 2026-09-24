import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/entrypoints/popup/App';
import type { EntryData } from '@/lib/types';

const { sendMessageMock } = vi.hoisted(() => ({ sendMessageMock: vi.fn() }));
vi.mock('@/lib/messages', () => ({
  sendMessage: sendMessageMock,
  isNotUnlockedError: (response: { success: boolean; error?: string }) => !response.success && response.error === 'NOT_UNLOCKED',
}));
vi.mock('@/entrypoints/popup/pages/EntryList', () => ({
  EntryList: () => <div>Entry list</div>,
}));

const importedEntry: EntryData = {
  id: 'imported-1', title: 'example.com', username: 'alice', password: 'secret',
  url: 'https://example.com', notes: '', tags: [], groupId: '', created: '', modified: '',
};
const appState = { status: 'unlocked' as const, meta: { name: 'Test vault', lastModified: '', entryCount: 1 } };

describe('popup CSV import end-to-end flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('browser', {
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    });
    sendMessageMock.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case 'GET_STATE': return { success: true, data: appState };
        case 'GET_ENTRIES': return { success: true, data: [] };
        case 'IMPORT_CSV_ENTRIES': return { success: true, data: [importedEntry] };
        case 'UNDO_CSV_IMPORT': return { success: true, data: null };
        default: return { success: true, data: null };
      }
    });
  });

  it('opens Import from the header menu, imports a CSV, and undoes only imported entries', async () => {
    render(<App />);
    await screen.findByText('Entry list');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import CSV' }));
    expect(await screen.findByRole('heading', { name: 'Import CSV' })).toBeTruthy();

    const file = new File(['name,username,password,url\nExample,alice,secret,https://example.com'], 'passwords.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => 'name,username,password,url\nExample,alice,secret,https://example.com' });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    await screen.findByText(/1 rows · 1 with passwords/);
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 login' }));
    await screen.findByText(/Imported 1 login/);
    expect(sendMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'IMPORT_CSV_ENTRIES',
      payload: { entries: [expect.objectContaining({ username: 'alice', password: 'secret', url: 'https://example.com' })] },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText('Import undone.');
    expect(sendMessageMock).toHaveBeenCalledWith({ type: 'UNDO_CSV_IMPORT', payload: { ids: ['imported-1'] } });
  });

  it('skips duplicate entries and rows without a password unless duplicates are enabled', async () => {
    sendMessageMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_STATE') return { success: true, data: appState };
      if (message.type === 'GET_ENTRIES') return { success: true, data: [importedEntry] };
      if (message.type === 'IMPORT_CSV_ENTRIES') return { success: true, data: [importedEntry] };
      return { success: true, data: null };
    });
    render(<App />);
    await screen.findByText('Entry list');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import CSV' }));

    const csv = 'name,username,password,url\nExisting,alice,secret,https://example.com\nNo password,bob,,https://other.example\nNew,carol,new-secret,https://new.example';
    const file = new File([csv], 'passwords.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => csv });
    fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });

    await screen.findByText(/3 rows · 2 with passwords · 1 matching existing entries/);
    expect(screen.getByRole('button', { name: 'Import 1 login' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Include duplicates'));
    expect(screen.getByRole('button', { name: 'Import 2 logins' })).toBeTruthy();
  });

  it('closes the header menu on Escape and after choosing a menu action', async () => {
    render(<App />);
    await screen.findByText('Entry list');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Password Generator' }));
    await screen.findByText('Password Generator');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
