import { useState, useEffect } from 'react';
import type { DatabaseMeta } from '@/lib/types';
import type { StateResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { PasswordInput } from '../components/PasswordInput';
import {
  clearUnlockDraft,
  loadRememberUnlockDuration,
  saveRememberUnlockDuration,
} from '@/lib/form-drafts';
import { DEFAULT_REMEMBER_UNLOCK_MS, REMEMBER_UNLOCK_OPTIONS } from '@/lib/constants';

interface Props {
  meta?: DatabaseMeta;
  onUnlocked: () => void;
}

export function Unlock({ meta, onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const [rememberDurationMs, setRememberDurationMs] = useState<number>(DEFAULT_REMEMBER_UNLOCK_MS);
  const [rememberPreferenceLoaded, setRememberPreferenceLoaded] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    clearUnlockDraft();
    loadRememberUnlockDuration().then((duration) => {
      setRememberDurationMs(duration);
      setRememberPreferenceLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (rememberPreferenceLoaded) void saveRememberUnlockDuration(rememberDurationMs);
  }, [rememberDurationMs, rememberPreferenceLoaded]);

  const handleUnlock = async () => {
    if (!password) {
      setError('Enter your master password');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await sendMessage<StateResponse>({
        type: 'UNLOCK',
        payload: { password, rememberDurationMs },
      });
      if (res.success) {
        await clearUnlockDraft();
        onUnlocked();
      } else {
        setError('Wrong password. Try again.');
      }
    } catch {
      setError('Failed to unlock database');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnlock();
  };

  return (
    <div className="p-4">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-800">
          {meta?.name || 'KeePass Database'}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {meta ? `${meta.entryCount} entries` : 'Enter your master password to unlock'}
        </p>
      </div>

      <div className="space-y-3" onKeyDown={handleKeyDown}>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Master Password
          </label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Enter master password"
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="remember-unlock" className="block text-sm font-medium text-gray-700 mb-1">
            Remember unlock for
          </label>
          <select
            id="remember-unlock"
            value={rememberDurationMs}
            onChange={(e) => setRememberDurationMs(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          >
            {REMEMBER_UNLOCK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            The vault locks after this much inactivity. Remembered unlock is cleared when Chrome closes.
          </p>
        </div>

        {error && (
          <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading}
          className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
