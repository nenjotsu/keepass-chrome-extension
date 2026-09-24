import { useState } from 'react';
import type { EntryData } from '@/lib/types';
import type { MessageResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { CopyButton } from '../components/CopyButton';
import { PasswordInput } from '../components/PasswordInput';

function displayTitle(entry: EntryData): string {
  if (entry.title && entry.title !== 'Untitled') return entry.title;
  const value = entry.url.trim();
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname || 'Untitled';
  } catch {
    return 'Untitled';
  }
}

interface Props {
  entry: EntryData;
  onEdit: (entry: EntryData) => void;
  onDelete: () => void;
  onBack: () => void;
  onSessionLost: (res: MessageResponse) => boolean;
}

export function EntryDetail({ entry, onEdit, onDelete, onBack, onSessionLost }: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [favorite, setFavorite] = useState(entry.favorite ?? false);

  const toggleFavorite = async () => {
    const nextFavorite = !favorite;
    const res = await sendMessage({
      type: 'UPDATE_ENTRY',
      payload: { entry: { ...entry, favorite: nextFavorite } },
    });
    if (!res.success) {
      onSessionLost(res);
      return;
    }
    setFavorite(nextFavorite);
  };

  const handleDelete = async () => {
    if (!deletePassword) {
      setDeleteError('Enter your master password');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await sendMessage({ type: 'DELETE_ENTRY', payload: { id: entry.id, password: deletePassword } });
      if (!res.success) {
        if (onSessionLost(res)) return;
        setDeletePassword('');
        setDeleteError('Wrong password. Try again.');
        return;
      }
      onDelete();
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setConfirmDelete(false);
    setDeletePassword('');
    setDeleteError('');
  };

  const fields = [
    { label: 'Username', value: entry.username, copyable: true },
    {
      label: 'Password',
      value: entry.password,
      copyable: true,
      secret: true,
    },
    { label: 'URL', value: entry.url, copyable: true, isLink: true },
    { label: 'Notes', value: entry.notes },
  ];

  return (
    <div className="p-4">
      {/* Title */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          {displayTitle(entry)}
        </h2>
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Fields */}
      <div className="space-y-3">
        {fields.map(
          (field) =>
            field.value && (
              <div
                key={field.label}
                className="bg-white rounded-lg border border-gray-200 p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {field.label}
                  </span>
                  <div className="flex items-center gap-1">
                    {'secret' in field && field.secret && (
                      <button
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-gray-400 hover:text-gray-600 p-1"
                        title={showPassword ? 'Hide' : 'Show'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {showPassword ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M15 12a3 3 0 01-3 3m0 0l6.879 6.879" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          )}
                        </svg>
                      </button>
                    )}
                    {'copyable' in field && field.copyable && (
                      <CopyButton text={field.value} entryId={entry.id} />
                    )}
                  </div>
                </div>
                {'isLink' in field && field.isLink ? (
                  <a
                    href={/^https?:\/\//i.test(field.value) ? field.value : `https://${field.value}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-emerald-600 hover:underline break-all"
                  >
                    {field.value}
                  </a>
                ) : 'secret' in field && field.secret ? (
                  <p className="text-sm text-gray-800 font-mono break-all">
                    {showPassword ? field.value : '••••••••••••'}
                  </p>
                ) : (
                  <p className="text-sm text-gray-800 break-all whitespace-pre-wrap">
                    {field.value}
                  </p>
                )}
              </div>
            ),
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={toggleFavorite}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${favorite ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {favorite ? '★' : '☆'}
        </button>
        <button
          onClick={() => onEdit(entry)}
          className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
        >
          Delete
        </button>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete entry?</h3>
            <p className="text-sm text-gray-600 mb-4">This action cannot be undone. Enter your master password to continue.</p>
            <div onKeyDown={(event) => event.key === 'Enter' && handleDelete()}>
              <label className="block text-sm font-medium text-gray-700 mb-1">Master Password</label>
              <PasswordInput value={deletePassword} onChange={setDeletePassword} placeholder="Enter master password" autoFocus />
            </div>
            {deleteError && <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg mt-3">{deleteError}</div>}
            <div className="flex gap-2 mt-4">
              <button onClick={cancelDelete} disabled={deleting} className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting || !deletePassword} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
