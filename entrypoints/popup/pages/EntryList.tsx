import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EntryData } from '@/lib/types';
import type { EntriesResponse, MessageResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';

type Tab = 'relevant' | 'all' | 'favorites' | 'recents';
interface Props {
  onSelect: (entry: EntryData) => void;
  onEdit: (entry: EntryData) => void;
  onAdd: () => void;
  onSessionLost: (res: MessageResponse) => boolean;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'relevant', label: 'All relevant' },
  { id: 'all', label: 'All items' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recents', label: 'Recents' },
];

export function EntryList({ onSelect, onEdit, onAdd, onSessionLost }: Props) {
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [pageEntries, setPageEntries] = useState<EntryData[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [pageTabId, setPageTabId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    const [entriesRes, recentRes] = await Promise.all([
      sendMessage<EntriesResponse>({ type: 'GET_ENTRIES' }),
      sendMessage({ type: 'GET_RECENT_ENTRY_IDS' }),
    ]);
    if (entriesRes.success) setEntries(entriesRes.data);
    else onSessionLost(entriesRes);
    if (recentRes.success && Array.isArray(recentRes.data)) setRecentIds(recentRes.data as string[]);
    else if (!recentRes.success) onSessionLost(recentRes);
    setLoading(false);
  }, [onSessionLost]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);
  useEffect(() => {
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !tab.url?.startsWith('http')) return;
        setPageTabId(tab.id);
        const res = await sendMessage<EntriesResponse>({ type: 'GET_ENTRIES_FOR_URL', payload: { url: tab.url } });
        if (res.success && res.data.length > 0) {
          setPageEntries(res.data);
          setActiveTab('relevant');
        }
      } catch { /* unavailable on browser pages */ }
    })();
  }, []);

  const displayedEntries = useMemo(() => {
    let result: EntryData[];
    if (activeTab === 'relevant') result = pageEntries;
    else if (activeTab === 'favorites') result = entries.filter((entry) => entry.favorite);
    else if (activeTab === 'recents') {
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      result = recentIds.flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [entry] : [];
      });
    } else result = entries;
    const query = search.trim().toLowerCase();
    return query
      ? result.filter((entry) => [entry.title, entry.username, entry.url, entry.notes, ...entry.tags].some((value) => value.toLowerCase().includes(query)))
      : result;
  }, [activeTab, entries, pageEntries, recentIds, search]);

  const handleFill = useCallback(async (entry: EntryData) => {
    if (pageTabId == null || entry.autoFill === false) return;
    const res = await sendMessage({ type: 'FILL_IN_TAB', payload: { tabId: pageTabId, entryId: entry.id } });
    if (!res.success) onSessionLost(res);
    else window.close();
  }, [pageTabId, onSessionLost]);

  const emptyMessage = search ? 'No entries found' : activeTab === 'relevant' ? 'No entries match this site' : activeTab === 'favorites' ? 'No favorite entries yet' : activeTab === 'recents' ? 'No recently used entries yet' : 'No passwords yet';

  return <div className="flex flex-col h-full">
    <div className="p-3 border-b border-gray-200">
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search passwords..." className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" autoFocus />
      </div>
    </div>
    <div className="flex border-b border-gray-200 px-3 pt-2 gap-1" role="tablist" aria-label="Entry filters">
      {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 whitespace-nowrap rounded-t-md px-1 py-2 text-xs font-medium transition-colors ${activeTab === tab.id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>{tab.label}</button>)}
    </div>
    <div className="flex-1 overflow-y-auto">
      {loading ? <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" /></div>
        : displayedEntries.length === 0 ? <div className="text-center py-12 px-4"><p className="text-gray-500 text-sm">{emptyMessage}</p>{activeTab === 'all' && !search && <p className="text-gray-400 text-xs mt-1">Click + to add your first entry</p>}</div>
          : <div className="divide-y divide-gray-600">{displayedEntries.map((entry) => {
            const canFill = activeTab === 'relevant' && entry.autoFill !== false;
            const canEdit = activeTab === 'relevant' || activeTab === 'all';
            const item = <>
              <DomainIcon url={entry.url} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{displayTitle(entry)} {entry.favorite && <span className="text-amber-500" aria-label="Favorite">★</span>}</p>
                <p className="text-xs text-gray-500 truncate">{entry.username}</p>
              </div>
              {canFill && <button onClick={(event) => { event.stopPropagation(); void handleFill(entry); }} disabled={pageTabId == null} className="rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Fill</button>}
              {canEdit && <button onClick={(event) => { event.stopPropagation(); onEdit(entry); }} className="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800" title="Edit entry" aria-label={`Edit ${displayTitle(entry)}`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m16.862 4.487 2.651 2.651M8 16l8.862-8.862a1.875 1.875 0 0 1 2.652 2.652L10.652 18.65a4 4 0 0 1-1.693 1.006L6 20l.344-2.959A4 4 0 0 1 7.35 15.35z" /></svg>
              </button>}
              {!canFill && !canEdit && <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>}
            </>;
            return activeTab === 'relevant'
              ? <div key={entry.id} className="entry-row flex items-center gap-3 px-4 py-3">{item}</div>
              : <div key={entry.id} role="button" tabIndex={0} onClick={() => onSelect(entry)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(entry); } }} className="entry-row w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">{item}</div>;
          })}</div>}
    </div>
    <div className="p-3 border-t border-gray-200"><button onClick={onAdd} className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>Add Entry</button></div>
  </div>;
}

function domainForUrl(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname || null;
  } catch {
    return null;
  }
}

function displayTitle(entry: EntryData): string {
  if (entry.title && entry.title !== 'Untitled') return entry.title;
  return domainForUrl(entry.url) ?? 'Untitled';
}

function DomainIcon({ url }: { url: string }) {
  const domain = domainForUrl(url);
  const [failed, setFailed] = useState(false);
  if (!domain || failed) return <FallbackIcon />;
  const pageUrl = new URL(`https://${domain}`).toString();
  const faviconUrl = new URL(browser.runtime.getURL('/_favicon/' as never));
  faviconUrl.searchParams.set('pageUrl', pageUrl);
  faviconUrl.searchParams.set('size', '32');
  return <img src={faviconUrl.toString()} onError={() => setFailed(true)} alt="" className="w-8 h-8 rounded-lg object-contain flex-shrink-0 bg-gray-100" />;
}

function FallbackIcon() {
  return <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center flex-shrink-0"><svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg></div>;
}
