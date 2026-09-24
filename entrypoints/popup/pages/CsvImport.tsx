import { useMemo, useState } from 'react';
import type { EntryData } from '@/lib/types';
import type { EntriesResponse, ImportedEntriesResponse, MessageResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';
import { inferTitle, normalizeCsvUrl, parseCsv, suggestCsvMapping } from '@/lib/csv-import';
import type { CsvField, CsvMapping, CsvTable } from '@/lib/csv-import';

const fields: Array<{ key: CsvField; label: string; required?: boolean }> = [
  { key: 'title', label: 'Title' }, { key: 'username', label: 'Username' },
  { key: 'password', label: 'Password', required: true }, { key: 'url', label: 'URL' }, { key: 'notes', label: 'Notes' },
];
type ImportEntry = Omit<EntryData, 'id' | 'created' | 'modified'>;

interface CsvImportProps {
  onSessionLost: (response: MessageResponse) => boolean;
  onImported: () => void;
}

export function CsvImport({ onSessionLost, onImported }: CsvImportProps) {
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [existing, setExisting] = useState<EntryData[]>([]);
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [summary, setSummary] = useState('');

  const mapped = useMemo(() => {
    if (!table || !mapping) return [];
    return table.rows.map((row) => {
      const get = (field: CsvField) => { const index = mapping[field]; return index === null ? '' : (row[index] ?? '').trim(); };
      const username = get('username');
      const url = get('url');
      return { title: get('title') || inferTitle(url, username), username, password: get('password'), url, notes: get('notes'), tags: [], groupId: '' } satisfies ImportEntry;
    });
  }, [table, mapping]);

  const isDuplicate = (candidate: ImportEntry) => existing.some((entry) =>
    entry.username.trim().toLocaleLowerCase() === candidate.username.trim().toLocaleLowerCase() &&
    entry.password === candidate.password &&
    normalizeCsvUrl(entry.url) === normalizeCsvUrl(candidate.url),
  );
  const validRows = mapped.filter((entry) => entry.password.length > 0);
  const duplicateCount = validRows.filter(isDuplicate).length;
  const readyRows = validRows.filter((entry) => includeDuplicates || !isDuplicate(entry));

  const handleFile = async (file?: File) => {
    setError(''); setSummary(''); setUndoIds([]); setTable(null); setMapping(null);
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      setTable(parsed); setMapping(suggestCsvMapping(parsed.headers));
      const response = await sendMessage<EntriesResponse>({ type: 'GET_ENTRIES' });
      if (!response.success) { if (onSessionLost(response)) return; throw new Error(response.error); }
      setExisting(response.data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read this CSV file.'); }
  };

  const importRows = async () => {
    setBusy(true); setError('');
    try {
      const response = await sendMessage<ImportedEntriesResponse>({ type: 'IMPORT_CSV_ENTRIES', payload: { entries: readyRows } });
      if (!response.success) { if (onSessionLost(response)) return; throw new Error(response.error); }
      const imported = response.data;
      setUndoIds(imported.map((entry) => entry.id));
      setSummary(`Imported ${imported.length} login${imported.length === 1 ? '' : 's'}. Skipped ${mapped.length - validRows.length} row(s) without a password${includeDuplicates ? '.' : ` and ${duplicateCount} duplicate(s).`}`);
      onImported();
    } catch (err) { setError(err instanceof Error ? err.message : 'Import failed.'); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    setBusy(true); setError('');
    try {
      const response = await sendMessage({ type: 'UNDO_CSV_IMPORT', payload: { ids: undoIds } });
      if (!response.success) { if (onSessionLost(response)) return; throw new Error(response.error); }
      setUndoIds([]); setSummary('Import undone.'); onImported();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not undo import.'); }
    finally { setBusy(false); }
  };

  return <section className="p-4 space-y-4">
    <div><h2 className="text-lg font-semibold">Import CSV</h2><p className="text-sm opacity-75">Choose a CSV exported from Chrome, Brave, Edge, Bitwarden, LastPass, or another password manager.</p></div>
    <label className="block text-sm font-medium">CSV file<input type="file" accept=".csv,text/csv" className="mt-2 block w-full text-sm" onChange={(event) => void handleFile(event.target.files?.[0])} /></label>
    {table && mapping && <>
      <div className="rounded-lg border p-3 space-y-2"><h3 className="font-medium text-sm">Match CSV columns</h3>{fields.map(({ key, label, required }) => <label key={key} className="flex items-center justify-between gap-3 text-sm"><span>{label}{required ? ' *' : ''}</span><select className="max-w-52 rounded border px-2 py-1" value={mapping[key] ?? ''} onChange={(event) => setMapping((current) => current ? { ...current, [key]: event.target.value === '' ? null : Number(event.target.value) } : current)}><option value="">Not mapped</option>{table.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}</div>
      <div className="text-sm space-y-1"><p>{table.rows.length} rows · {validRows.length} with passwords · {duplicateCount} matching existing entries</p><label className="flex items-center gap-2"><input type="checkbox" checked={includeDuplicates} onChange={(event) => setIncludeDuplicates(event.target.checked)} />Include duplicates</label></div>
      <div className="max-h-36 overflow-auto rounded-lg border text-xs"><div className="grid grid-cols-3 gap-2 bg-black/5 px-2 py-1 font-medium"><span>Title</span><span>Username</span><span>URL</span></div>{mapped.slice(0, 10).map((entry, index) => <div key={index} className="grid grid-cols-3 gap-2 border-t px-2 py-1"><span className="truncate">{entry.title}</span><span className="truncate">{entry.username}</span><span className="truncate">{entry.url}</span></div>)}{mapped.length > 10 && <p className="px-2 py-1 opacity-70">Showing first 10 rows</p>}</div>
      <button type="button" disabled={busy || readyRows.length === 0 || mapping.password === null} onClick={() => void importRows()} className="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Importing…' : `Import ${readyRows.length} login${readyRows.length === 1 ? '' : 's'}`}</button>
    </>}
    {summary && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{summary}{undoIds.length > 0 && <button type="button" disabled={busy} onClick={() => void undo()} className="ml-2 font-semibold underline">Undo</button>}</div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p className="text-xs opacity-60">CSV data is processed locally. Rows without passwords are skipped; non-login record types are not imported.</p>
  </section>;
}
