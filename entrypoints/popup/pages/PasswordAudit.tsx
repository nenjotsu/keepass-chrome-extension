import { useEffect, useState } from 'react';
import type { EntryData } from '@/lib/types';
import type { MessageResponse, EntriesResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { checkBreachedPasswords, findWeakPasswords, type PasswordAuditResult } from '@/lib/password-audit';

interface Props {
  kind: 'breached' | 'weak';
  onEdit: (entry: EntryData) => void;
  onSessionLost: (res: MessageResponse) => boolean;
}

export function PasswordAudit({ kind, onEdit, onSessionLost }: Props) {
  const [results, setResults] = useState<PasswordAuditResult[]>([]);
  const [entriesById, setEntriesById] = useState<Map<string, EntryData>>(new Map());
  const [checkedCount, setCheckedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await sendMessage<EntriesResponse>({ type: 'GET_ENTRIES' });
      if (!response.success) {
        onSessionLost(response);
        if (!cancelled) { setError(response.error); setLoading(false); }
        return;
      }
      if (cancelled) return;
      const entries: EntryData[] = response.data;
      setEntriesById(new Map(entries.map((entry) => [entry.id, entry])));
      setCheckedCount(entries.filter((entry) => entry.password).length);
      try {
        const auditResults = kind === 'breached'
          ? await checkBreachedPasswords(entries)
          : findWeakPasswords(entries);
        if (cancelled) return;
        setResults(auditResults);
        if (kind === 'breached') {
          const saved = await sendMessage({ type: 'SAVE_BREACH_RESULTS', payload: { results: auditResults.map(({ id, modified, breached }) => ({ id, modified, breached: Boolean(breached) })) } });
          if (!saved.success) onSessionLost(saved);
        }
      } catch {
        if (!cancelled) setError('Could not complete the breach check. Check your internet connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, onSessionLost]);

  const title = kind === 'breached' ? 'Leaked password check' : 'Weak password check';
  return <section className="p-4 space-y-3">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {kind === 'breached' && <p className="text-xs text-gray-500">Passwords are checked using HIBP’s privacy-preserving range lookup. The password and full hash stay on your device.</p>}
    {loading ? <div role="status" className="flex items-center justify-center gap-2 py-8 text-center text-sm text-gray-600">{checkedCount === null ? 'Loading saved passwords…' : <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />{`Checking passwords in ${checkedCount} entr${checkedCount === 1 ? 'y' : 'ies'}…`}</>}</div>
      : error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      : results.length === 0
        ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">No {kind === 'breached' ? 'known breached' : 'weak'} passwords found.</p>
        : <>
          <p className="text-sm text-gray-700">{results.length} {kind === 'breached' ? 'saved entr' + (results.length === 1 ? 'y uses a password found in known breach data.' : 'ies use passwords found in known breach data.') : 'weak password' + (results.length === 1 ? ' found.' : 's found.')}</p>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {results.map((result) => {
              const url = webUrlForEntry(entriesById.get(result.id)?.url ?? '');
              return <li key={result.id} className="flex items-center gap-2 px-3 py-2 text-sm text-gray-800">
              {kind === 'breached' && <WarningIcon />}
              <span className="min-w-0 flex-1 truncate" title={result.title}>{result.title}</span>
              {kind === 'weak' && <span className="text-xs text-amber-700">Weak</span>}
              {url && <button type="button" onClick={() => { void browser.tabs.create({ url }); }} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100" aria-label={`Open ${result.title} in a new tab`} title="Open site in new tab">Open</button>}
              <button type="button" onClick={() => { const entry = entriesById.get(result.id); if (entry) onEdit(entry); }} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100" aria-label={`Edit ${result.title}`} title="Edit entry">Edit</button>
              </li>;
            })}
          </ul>
          {kind === 'breached' && <p className="text-xs text-gray-500">A match means this password appears in known breach data; it does not confirm that the particular account was breached.</p>}
        </>}
  </section>;
}

function webUrlForEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function WarningIcon() {
  return <span aria-label="Password appears in known breach data" title="Password appears in known breach data" className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold leading-none text-red-700">!</span>;
}
