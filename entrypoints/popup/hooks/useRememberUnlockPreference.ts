import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_REMEMBER_UNLOCK_MS } from '@/lib/constants';
import { loadRememberUnlockDuration, saveRememberUnlockDuration } from '@/lib/form-drafts';

export function useRememberUnlockPreference() {
  const [durationMs, setDurationMs] = useState(DEFAULT_REMEMBER_UNLOCK_MS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadRememberUnlockDuration().then((duration) => {
      if (!active) return;
      setDurationMs(duration);
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  const updateDurationMs = useCallback((duration: number) => {
    setDurationMs(duration);
    if (ready) void saveRememberUnlockDuration(duration);
  }, [ready]);

  return { durationMs, updateDurationMs, ready };
}
