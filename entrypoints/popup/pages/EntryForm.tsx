import { useState, useEffect, useCallback } from 'react';
import type { EntryData } from '@/lib/types';
import type { EntryResponse, GeneratePasswordResponse, MessageResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { PasswordInput } from '../components/PasswordInput';
import { StrengthMeter } from '../components/StrengthMeter';
import { RememberUnlockSelect } from '../components/RememberUnlockSelect';
import {
  loadEntryFormDraft,
  saveEntryFormDraft,
  clearEntryFormDraft,
} from '@/lib/form-drafts';
import { useRememberUnlockPreference } from '../hooks/useRememberUnlockPreference';

interface Props {
  entry?: EntryData;
  onSaved: () => void;
  onCancel: () => void;
  onSessionLost: (res: MessageResponse) => boolean;
}

export function EntryForm({ entry, onSaved, onCancel, onSessionLost }: Props) {
  const isEditing = !!entry;

  const [kind, setKind] = useState<'login' | 'secure_note'>(entry?.kind ?? 'login');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [username, setUsername] = useState(entry?.username ?? '');
  const [password, setPassword] = useState(entry?.password ?? '');
  const [totpSecret, setTotpSecret] = useState(entry?.totpSecret ?? '');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [tags, setTags] = useState(entry?.tags.join(', ') ?? '');
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [autoFill, setAutoFill] = useState(entry?.autoFill ?? true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordRequired, setDeletePasswordRequired] = useState(true);
  const [deleteRequirementLoading, setDeleteRequirementLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const { durationMs, updateDurationMs, ready: rememberPreferenceLoaded } = useRememberUnlockPreference();

  // Load draft (new or edit) or init from entry when no draft
  useEffect(() => {
    const entryId = entry?.id;
    loadEntryFormDraft(entryId).then((draft) => {
      if (draft) {
        setTitle(draft.title);
        setKind(draft.kind ?? 'login');
        setUsername(draft.username);
        setPassword(draft.password || entry?.password || '');
        setUrl(draft.url);
        setNotes(draft.notes);
        setTags(draft.tags);
        setAutoFill(draft.autoFill);
        setRestoredFromDraft(true);
      } else {
        if (entry) {
          setTitle(entry.title ?? '');
          setKind(entry.kind ?? 'login');
          setUsername(entry.username ?? '');
          setPassword(entry.password ?? '');
          setTotpSecret(entry.totpSecret ?? '');
          setUrl(entry.url ?? '');
          setNotes(entry.notes ?? '');
          setTags(entry.tags?.join(', ') ?? '');
          setFavorite(entry.favorite ?? false);
          setAutoFill(entry.autoFill ?? true);
        }
        setRestoredFromDraft(false);
      }
    });
  }, [entry?.id]);

  const draft = { kind, title, username, password, url, notes, tags, autoFill };
  const entryId = entry?.id;

  // Unsaved changes detection (edit mode only)
  const entryTagsStr = entry?.tags?.join(', ') ?? '';
  const titleChanged = (title || '').trim() !== (entry?.title ?? '').trim();
  const usernameChanged = username !== (entry?.username ?? '');
  const passwordChanged = password !== (entry?.password ?? '');
  const urlChanged = url !== (entry?.url ?? '');
  const notesChanged = notes !== (entry?.notes ?? '');
  const tagsChanged = tags !== entryTagsStr;
  const autoFillChanged = autoFill !== (entry?.autoFill ?? true);
  const hasUnsavedChanges =
    isEditing && (titleChanged || usernameChanged || passwordChanged || urlChanged || notesChanged || tagsChanged || autoFillChanged || kind !== (entry?.kind ?? 'login') || totpSecret !== (entry?.totpSecret ?? ''));

  // Save draft on change (debounced)
  useEffect(() => {
    const t = setTimeout(() => saveEntryFormDraft(draft, entryId), 300);
    return () => clearTimeout(t);
  }, [kind, title, username, password, url, notes, tags, autoFill, entryId]);

  // Save immediately on blur — before popup may close when user clicks away to copy
  const saveDraftNow = useCallback(() => {
    saveEntryFormDraft(draft, entryId);
  }, [kind, title, username, password, url, notes, tags, autoFill, entryId]);

  const handleGeneratePassword = async () => {
    const res = await sendMessage<GeneratePasswordResponse>({
      type: 'GENERATE_PASSWORD',
    });
    if (res.success) {
      setPassword(res.data);
    }
  };

  const showDeleteConfirmation = async () => {
    if (!entry) return;
    setConfirmDelete(true);
    setDeleteRequirementLoading(true);
    setDeletePasswordRequired(true);
    setDeleteError('');
    const res = await sendMessage<{ success: true; data: boolean } | { success: false; error: string }>({ type: 'GET_DELETE_PASSWORD_REQUIREMENT' });
    setDeleteRequirementLoading(false);
    if (!res.success) {
      if (onSessionLost(res)) return;
      setDeleteError(res.error);
      return;
    }
    setDeletePasswordRequired(res.data);
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (deletePasswordRequired && !rememberPreferenceLoaded) return;
    if (deletePasswordRequired && !deletePassword) {
      setDeleteError('Enter your master password');
      return;
    }
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await sendMessage({ type: 'DELETE_ENTRY', payload: { id: entry.id, password: deletePassword || undefined, rememberDurationMs: durationMs } });
      if (!res.success) {
        if (onSessionLost(res)) return;
        if (res.error === 'MASTER_PASSWORD_REQUIRED') {
          setDeletePasswordRequired(true);
          setDeleteError('Enter your master password');
          return;
        }
        setDeletePassword('');
        setDeleteError(res.error === 'INVALID_MASTER_PASSWORD' ? 'Wrong password. Try again.' : res.error);
        return;
      }
      await clearEntryFormDraft(entry.id);
      onSaved();
    } finally {
      setDeleteLoading(false);
    }
  };

  const cancelDelete = () => {
    setConfirmDelete(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setLoading(true);
    setError('');

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (isEditing) {
        const res = await sendMessage<EntryResponse>({
          type: 'UPDATE_ENTRY',
          payload: {
            entry: {
              ...entry,
              title: title.trim(),
              kind,
              username,
              password: kind === 'login' ? password : '',
              totpSecret: kind === 'login' ? totpSecret.replace(/\s/g, '') : '',
              url,
              notes,
              tags: parsedTags,
              favorite,
              autoFill: kind === 'login' && autoFill,
            },
          },
        });
        if (!res.success) {
          if (onSessionLost(res)) return;
          setError(res.error);
          return;
        }
      } else {
        const res = await sendMessage<EntryResponse>({
          type: 'CREATE_ENTRY',
          payload: {
            entry: {
              title: title.trim(),
              kind,
              username,
              password: kind === 'login' ? password : '',
              totpSecret: kind === 'login' ? totpSecret.replace(/\s/g, '') : '',
              url,
              notes,
              tags: parsedTags,
              groupId: '',
              favorite,
              autoFill: kind === 'login' && autoFill,
            },
          },
        });
        if (!res.success) {
          if (onSessionLost(res)) return;
          setError(res.error);
          return;
        }
      }
      await clearEntryFormDraft(entry?.id);
      onSaved();
    } catch {
      setError('Failed to save entry');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = (changed: boolean) =>
    'w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none ' +
    (changed ? 'border-amber-400 bg-amber-50' : 'border-gray-300');

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          {isEditing ? 'Edit Entry' : 'New Entry'}
        </h2>
        {isEditing && <button type="button" onClick={() => void showDeleteConfirmation()} disabled={loading || deleteLoading} aria-label="Delete entry" title="Delete entry" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
          </svg>
        </button>}
      </div>
      {hasUnsavedChanges && restoredFromDraft && (
          <p className="mt-1 inline-block rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-sm text-amber-800">
            You have unsaved changes
          </p>
      )}

      <div className="space-y-3" onBlur={saveDraftNow}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Entry type</label>
          <select value={kind} onChange={(e) => { const next = e.target.value as 'login' | 'secure_note'; setKind(next); if (next === 'secure_note') setAutoFill(false); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="login">Login</option>
            <option value="secure_note">Secure note</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass(isEditing && titleChanged)}
            placeholder="e.g. Gmail, GitHub..."
            autoFocus
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
          Favorite
        </label>
        {kind === 'login' && <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFill(e.target.checked)} className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" />
          Allow Auto Fill
        </label>}

        {kind === 'login' && <>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={fieldClass(isEditing && usernameChanged)}
            placeholder="user@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Password
          </label>
          <div className="flex gap-2">
            <div className="flex-1">
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="Password"
                className={
                  isEditing && passwordChanged ? 'border-amber-400 bg-amber-50' : 'border-gray-300'
                }
              />
            </div>
            <button
              type="button"
              onClick={handleGeneratePassword}
              className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition-colors flex-shrink-0"
              title="Generate password"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <StrengthMeter password={password} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Authenticator secret (Base32)</label>
          <input type="password" autoComplete="off" value={totpSecret} onChange={(e) => setTotpSecret(e.target.value)} className={fieldClass(isEditing && totpSecret !== (entry?.totpSecret ?? ''))} placeholder="Optional TOTP secret" />
          <p className="mt-1 text-xs text-gray-500">Stored encrypted in the vault. Spaces and padding are accepted.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            URL
          </label>
          <p className="text-xs text-gray-500 mb-1">
            Required for autofill on websites — hostname only (e.g. italki.com, mail.example.com)
          </p>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={fieldClass(isEditing && urlChanged)}
            placeholder="italki.com"
          />
        </div>
        </>}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={fieldClass(isEditing && notesChanged) + ' resize-none'}
            placeholder="Additional notes..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tags
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className={fieldClass(isEditing && tagsChanged)}
            placeholder="tag1, tag2, ..."
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Entry'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {confirmDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby="edit-delete-title" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
          <h3 id="edit-delete-title" className="mb-2 text-lg font-semibold text-gray-900">Delete entry?</h3>
          <p className="mb-4 text-sm text-gray-600">This action cannot be undone.{deletePasswordRequired ? ' Enter your master password to continue.' : ''}</p>
          {deletePasswordRequired && <div onKeyDown={(event) => event.key === 'Enter' && void handleDelete()}>
            <label className="mb-1 block text-sm font-medium text-gray-700">Master Password</label>
            <PasswordInput value={deletePassword} onChange={setDeletePassword} placeholder="Enter master password" autoFocus />
            <div className="mt-3"><RememberUnlockSelect id="form-delete-remember" value={durationMs} onChange={updateDurationMs} disabled={!rememberPreferenceLoaded || deleteLoading} /></div>
          </div>}
          {deleteError && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{deleteError}</div>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={cancelDelete} disabled={deleteLoading} className="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void handleDelete()} disabled={deleteLoading || deleteRequirementLoading || (deletePasswordRequired && (!deletePassword || !rememberPreferenceLoaded))} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{deleteLoading ? 'Deleting...' : 'Delete'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
