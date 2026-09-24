import { useEffect, useState } from 'react';
import type { DatabaseMeta } from '@/lib/types';
import type { StateResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { PasswordInput } from '../components/PasswordInput';
import { RememberUnlockSelect } from '../components/RememberUnlockSelect';
import { clearUnlockDraft } from '@/lib/form-drafts';
import { useRememberUnlockPreference } from '../hooks/useRememberUnlockPreference';

interface Props {
  meta?: DatabaseMeta;
  onUnlocked: () => void;
}

export function Unlock({ meta, onUnlocked }: Props) {
  const [password, setPassword] = useState('');
  const { durationMs: rememberDurationMs, updateDurationMs, ready: rememberPreferenceLoaded } = useRememberUnlockPreference();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { void clearUnlockDraft(); }, []);

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

        <RememberUnlockSelect id="remember-unlock" value={rememberDurationMs} onChange={updateDurationMs} disabled={!rememberPreferenceLoaded} />

        {error && (
          <div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading || !rememberPreferenceLoaded}
          className="w-full bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
