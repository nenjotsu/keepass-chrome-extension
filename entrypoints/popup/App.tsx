import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppState, EntryData } from '@/lib/types';
import type { StateResponse, MessageResponse, ExportResponse } from '@/lib/messages';
import { sendMessage, isNotUnlockedError } from '@/lib/messages';
import { CreateVault } from './pages/CreateVault';
import { Unlock } from './pages/Unlock';
import { EntryList } from './pages/EntryList';
import { EntryForm } from './pages/EntryForm';
import { EntryDetail } from './pages/EntryDetail';
import { Generator } from './pages/Generator';
import { PasswordInput } from './components/PasswordInput';
import { CsvImport } from './pages/CsvImport';
import { PasswordAudit } from './pages/PasswordAudit';

type Page =
  | { name: 'loading' }
  | { name: 'create_vault' }
  | { name: 'unlock' }
  | { name: 'entry_list' }
  | { name: 'entry_detail'; entry: EntryData }
  | { name: 'entry_form'; entry?: EntryData }
  | { name: 'generator' }
  | { name: 'csv_import' }
  | { name: 'password_audit'; kind: 'breached' | 'weak' };

type ThemeName = 'green' | 'blue' | 'purple' | 'pink';
type ThemeMode = 'light' | 'dark';
const themes: Array<{ id: ThemeName; label: string; color: string }> = [
  { id: 'green', label: 'Pastel green', color: '#a7d7bd' },
  { id: 'blue', label: 'Pastel blue', color: '#a9c9e8' },
  { id: 'purple', label: 'Pastel purple', color: '#c6b6e8' },
  { id: 'pink', label: 'Pastel pink', color: '#efb8c9' },
];

function isPage(value: unknown): value is Page {
  if (!value || typeof value !== 'object' || !('name' in value)) return false;
  return ['create_vault', 'unlock', 'entry_list', 'entry_detail', 'entry_form', 'generator', 'csv_import'].includes(
    (value as { name: unknown }).name as string,
  );
}

function App() {
  const [page, setPage] = useState<Page>({ name: 'loading' });
  const [appState, setAppState] = useState<AppState | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingDatabase, setDeletingDatabase] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('green');
  const [themeReady, setThemeReady] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBreachConsent, setShowBreachConsent] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    void browser.storage.local.get(['uiTheme', 'uiAppearance']).then((stored) => {
      const value = stored.uiTheme;
      if (themes.some((option) => option.id === value)) setTheme(value as ThemeName);
      if (stored.uiAppearance === 'dark' || stored.uiAppearance === 'light') setThemeMode(stored.uiAppearance);
      setThemeReady(true);
    }).catch(() => setThemeReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (themeReady) void browser.storage.local.set({ uiTheme: theme });
  }, [theme, themeReady]);

  useEffect(() => {
    document.documentElement.dataset.appearance = themeMode;
    if (themeReady) void browser.storage.local.set({ uiAppearance: themeMode });
  }, [themeMode, themeReady]);

  /**
   * Check any response for NOT_UNLOCKED error.
   * If the service worker restarted and the DB is no longer in memory,
   * redirect the user to the unlock page.
   * Returns true if the error was handled (caller should abort its flow).
   */
  const handleSessionLost = useCallback((res: MessageResponse): boolean => {
    if (isNotUnlockedError(res)) {
      setAppState((prev) =>
        prev && prev.status === 'unlocked'
          ? { status: 'locked', meta: prev.meta }
          : prev,
      );
      setPage({ name: 'unlock' });
      return true;
    }
    return false;
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await sendMessage<StateResponse>({ type: 'GET_STATE' });

      if (res.success) {
        setAppState(res.data);
        const state = res.data;

        if (state.status === 'no_database') {
          setPage({ name: 'create_vault' });
        } else if (state.status === 'locked') {
          setPage({ name: 'unlock' });
        } else {
          setPage({ name: 'entry_list' });
        }
      } else {
        // Background service not available — default to create vault screen
        console.warn('[App] Failed to get state from background');
        setPage({ name: 'create_vault' });
      }
    } catch (err) {
      console.error('[App] Failed to refresh state:', err);
    }
  }, []);

  // On mount: fetch appState (needed for header), restore page from storage when valid
  useEffect(() => {
    (async () => {
      try {
        const res = await sendMessage<StateResponse>({ type: 'GET_STATE' });
        if (res.success) setAppState(res.data);
        const state = res.success ? res.data : null;
        const { popupPageState } = await browser.storage.local.get('popupPageState');
        const savedPage = isPage(popupPageState) ? popupPageState : null;

        if (state?.status === 'unlocked' && savedPage) {
          setPage(savedPage);
        } else if (state?.status === 'locked') {
          setPage(savedPage?.name === 'unlock' ? savedPage : { name: 'unlock' });
        } else if (state?.status === 'no_database') {
          setPage(savedPage?.name === 'create_vault' ? savedPage : { name: 'create_vault' });
        } else {
          setPage(state?.status === 'unlocked' ? { name: 'entry_list' } : { name: 'create_vault' });
        }
      } catch (err) {
        console.error('[App] Failed to load:', err);
        setPage({ name: 'create_vault' });
      }
    })();
  }, []);

  // Always save page state for restore on reopen
  useEffect(() => {
    if (page.name === 'loading') return;
    browser.storage.local.set({ popupPageState: page }).catch(() => {});
  }, [page]);

  const handleLock = async () => {
    try {
      await sendMessage({ type: 'LOCK' });
      await refreshState();
    } catch (err) {
      console.error('[App] Failed to lock database:', err);
    }
  };

  const handleImportComplete = async () => {
    const res = await sendMessage<StateResponse>({ type: 'GET_STATE' });
    if (res.success) setAppState(res.data);
  };

  const startAudit = async (kind: 'breached' | 'weak') => {
    setMenuOpen(false);
    if (kind === 'breached') {
      const { hibpConsentAccepted } = await browser.storage.local.get('hibpConsentAccepted');
      if (hibpConsentAccepted !== true) {
        setShowBreachConsent(true);
        return;
      }
    }
    setPage({ name: 'password_audit', kind });
  };

  const acceptBreachConsent = async () => {
    await browser.storage.local.set({ hibpConsentAccepted: true });
    setShowBreachConsent(false);
    setPage({ name: 'password_audit', kind: 'breached' });
  };

  const handleDeleteDatabase = async () => {
    if (!deletePassword) {
      setDeleteError('Enter your master password');
      return;
    }
    setDeletingDatabase(true);
    setDeleteError('');
    try {
      const res = await sendMessage({ type: 'DELETE_DATABASE', payload: { password: deletePassword } });
      if (!res.success) {
        if (handleSessionLost(res)) return;
        setDeletePassword('');
        setDeleteError('Wrong password. Try again.');
        return;
      }
      setShowDeleteConfirm(false);
      setDeletePassword('');
      await refreshState();
    } finally {
      setDeletingDatabase(false);
    }
  };

  const cancelDeleteDatabase = () => {
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleExportDatabase = async () => {
    try {
      console.log('[Export] Requesting export from background...');
      const res = await sendMessage<ExportResponse>({ type: 'EXPORT_DATABASE' });
      if (res.success && res.data) {
        console.log('[Export] Got data from background, size:', res.data.length);

        // Create blob from array
        const buffer = new Uint8Array(res.data);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        // Create filename with database name
        const dbName = appState?.status === 'unlocked' ? appState.meta.name : 'keepass';
        const filename = `${dbName}-export-${new Date().toISOString().split('T')[0]}.kdbx`;
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);

        console.log('[Export] Clicking download link, filename:', filename);
        link.click();

        // Cleanup
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('[Export] Download completed');
        }, 100);
      } else {
        console.error('[Export] Export failed:', 'error' in res ? res.error : 'No export data returned');
      }
    } catch (err) {
      console.error('[Export] Error:', err);
    }
  };

  const header = (
    <div className="theme-header flex items-center justify-between px-4 py-3 text-white">
      <div className="flex items-center gap-2">
        {page.name !== 'entry_list' &&
          page.name !== 'create_vault' &&
          page.name !== 'unlock' &&
          page.name !== 'loading' && (
            <button
              onClick={() => setPage({ name: 'entry_list' })}
              className="hover:bg-emerald-700 rounded p-1 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        <h1 className="text-base font-semibold">KeePass</h1>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => setThemeMode((mode) => mode === 'light' ? 'dark' : 'light')} className="theme-mode-toggle" aria-pressed={themeMode === 'dark'} aria-label={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`} title={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`}>{themeMode === 'light' ? 'Light' : 'Dark'}</button>
        <div className="flex items-center gap-1 rounded-full bg-black/10 px-1.5 py-1" role="group" aria-label="Theme accent color">
          {themes.map((option) => <button key={option.id} type="button" onClick={() => setTheme(option.id)} aria-label={`${option.label} theme`} aria-pressed={theme === option.id} title={option.label} className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-125 ${theme === option.id ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent' : ''}`} style={{ backgroundColor: option.color }} />)}
        </div>
        {appState?.status === 'unlocked' && (
          <>
            {page.name === 'entry_list' && (
              <button
                onClick={() => setPage({ name: 'entry_form' })}
                className="hover:bg-emerald-700 rounded p-1.5 transition-colors"
                title="Add Entry"
                aria-label="Add entry"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="hover:bg-emerald-700 rounded p-1.5 transition-colors"
                aria-label="Open menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="More actions"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1" strokeWidth={2} />
                  <circle cx="12" cy="12" r="1" strokeWidth={2} />
                  <circle cx="19" cy="12" r="1" strokeWidth={2} />
                </svg>
              </button>
              {menuOpen && (
                <div role="menu" aria-label="Database actions" className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-gray-800 shadow-xl">
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setPage({ name: 'csv_import' }); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Import CSV</button>
                  <button role="menuitem" onClick={() => void startAudit('breached')} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Check leaked passwords</button>
                  <button role="menuitem" onClick={() => void startAudit('weak')} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Check weak passwords</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setPage({ name: 'generator' }); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Password Generator</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); void handleExportDatabase(); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Export Database</button>
                  <div role="separator" className="my-1 border-t border-gray-100" />
                  <button role="menuitem" onClick={() => { setMenuOpen(false); void handleLock(); }} className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100">Lock Database</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setShowDeleteConfirm(true); }} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">Delete Database</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  const renderPage = () => {
    switch (page.name) {
      case 'loading':
        return (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
          </div>
        );
      case 'create_vault':
        return <CreateVault onCreated={refreshState} />;
      case 'unlock':
        return (
          <Unlock
            meta={appState?.status === 'locked' ? appState.meta : undefined}
            onUnlocked={refreshState}
          />
        );
      case 'entry_list':
        return (
          <EntryList
            themeMode={themeMode}
            onSelect={(entry) => setPage({ name: 'entry_detail', entry })}
            onEdit={(entry) => setPage({ name: 'entry_form', entry })}
            onAdd={() => setPage({ name: 'entry_form' })}
            onSessionLost={handleSessionLost}
          />
        );
      case 'entry_detail':
        return (
          <EntryDetail
            entry={page.entry}
            onEdit={(entry) => setPage({ name: 'entry_form', entry })}
            onDelete={() => setPage({ name: 'entry_list' })}
            onBack={() => setPage({ name: 'entry_list' })}
            onSessionLost={handleSessionLost}
          />
        );
      case 'entry_form':
        return (
          <EntryForm
            entry={page.entry}
            onSaved={() => setPage({ name: 'entry_list' })}
            onCancel={() =>
              page.entry
                ? setPage({ name: 'entry_detail', entry: page.entry })
                : setPage({ name: 'entry_list' })
            }
            onSessionLost={handleSessionLost}
          />
        );
      case 'generator':
        return <Generator />;
      case 'csv_import':
        return <CsvImport onSessionLost={handleSessionLost} onImported={() => void handleImportComplete()} />;
      case 'password_audit':
        return <PasswordAudit
          kind={page.kind}
          onEdit={(entry) => setPage({ name: 'entry_form', entry })}
          onSessionLost={handleSessionLost}
        />;
    }
  };

  return (
    <div data-theme={theme} data-appearance={themeMode} className="theme-shell w-full min-h-[500px] flex flex-col">
      {header}
      <div className="theme-content flex-1 overflow-y-auto">{renderPage()}</div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Delete Database?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              This will permanently delete all your passwords. This action cannot be undone. Enter your master password to continue.
            </p>
            <div onKeyDown={(event) => event.key === 'Enter' && handleDeleteDatabase()}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Master Password</label>
              <PasswordInput value={deletePassword} onChange={setDeletePassword} placeholder="Enter master password" autoFocus />
            </div>
            {deleteError && <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg mt-3">{deleteError}</div>}
            <div className="flex gap-2 mt-4">
              <button
                onClick={cancelDeleteDatabase}
                disabled={deletingDatabase}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteDatabase}
                disabled={deletingDatabase || !deletePassword}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deletingDatabase ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBreachConsent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="breach-consent-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 id="breach-consent-title" className="mb-2 text-lg font-semibold text-gray-900">Check passwords against known breaches?</h3>
            <p className="text-sm text-gray-600">For each distinct saved password, this check sends the first five characters of its SHA-1 hash to Have I Been Pwned. The password and full hash stay on your device; the returned data is compared locally. HIBP receives these partial-hash requests.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setShowBreachConsent(false)} className="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</button>
              <button onClick={() => void acceptBreachConsent()} className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">Continue</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
