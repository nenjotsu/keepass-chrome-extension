import { useState, useEffect, useCallback, useMemo } from 'react';
import type { EntryData, GroupData } from '@/lib/types';
import type { EntriesResponse, MessageResponse } from '@/lib/messages';
import { sendMessage } from '@/lib/messages';

type Tab = 'relevant' | 'all' | 'folders' | 'recents' | 'favorites';
const UNFILED_GROUP_ID = '__unfiled__';
interface Props {
  themeMode: 'light' | 'dark';
  onSelect: (entry: EntryData) => void;
  onEdit: (entry: EntryData) => void;
  onAdd: () => void;
  onSessionLost: (res: MessageResponse) => boolean;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'relevant', label: 'Relevant' },
  { id: 'all', label: 'All' },
  { id: 'folders', label: 'Folders' },
  { id: 'recents', label: 'Recents' },
  { id: 'favorites', label: 'Favorites' },
];

export function EntryList({ themeMode, onSelect, onEdit, onAdd, onSessionLost }: Props) {
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [pageEntries, setPageEntries] = useState<EntryData[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [breachedEntryIds, setBreachedEntryIds] = useState<Set<string>>(new Set());
  const [pageTabId, setPageTabId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupData[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [folderEditor, setFolderEditor] = useState<{ type: 'create' } | { type: 'rename'; group: GroupData } | null>(null);
  const [folderName, setFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<GroupData | null>(null);
  const [folderError, setFolderError] = useState('');

  const loadEntries = useCallback(async () => {
    const [entriesRes, recentRes, groupsRes] = await Promise.all([
      sendMessage<EntriesResponse>({ type: 'GET_ENTRIES' }),
      sendMessage({ type: 'GET_RECENT_ENTRY_IDS' }),
      sendMessage<{ success: true; data: GroupData[] } | { success: false; error: string }>({ type: 'GET_GROUPS' }),
    ]);
    if (entriesRes.success) setEntries(entriesRes.data);
    else onSessionLost(entriesRes);
    if (groupsRes.success) setGroups(groupsRes.data);
    else onSessionLost(groupsRes);
    if (recentRes.success && Array.isArray(recentRes.data)) setRecentIds(recentRes.data as string[]);
    else if (!recentRes.success) onSessionLost(recentRes);
    const breachedRes = await sendMessage<MessageResponse<string[]>>({ type: 'GET_BREACHED_ENTRY_IDS' });
    if (breachedRes.success) setBreachedEntryIds(new Set(breachedRes.data));
    else onSessionLost(breachedRes);
    setLoading(false);
  }, [onSessionLost]);

  useEffect(() => { void loadEntries(); }, [loadEntries]);
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab, search, activeGroupId]);
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
    if (activeTab === 'folders' && !activeGroupId) result = [];
    else if (activeTab === 'folders' && activeGroupId === UNFILED_GROUP_ID) result = result.filter((entry) => !entry.groupId);
    else if (activeTab === 'folders' && activeGroupId) result = result.filter((entry) => entry.groupId === activeGroupId);
    return query
      ? result.filter((entry) => [entry.title, entry.username, entry.url, entry.notes, ...entry.tags].some((value) => value.toLowerCase().includes(query)))
      : result;
  }, [activeTab, entries, pageEntries, recentIds, search, activeGroupId]);

  const refreshGroups = async () => {
    const res = await sendMessage<{ success: true; data: GroupData[] } | { success: false; error: string }>({ type: 'GET_GROUPS' });
    if (res.success) setGroups(res.data);
    else onSessionLost(res);
  };
  const addFolder = async () => {
    setFolderEditor({ type: 'create' });
    setFolderName('');
    setFolderError('');
  };
  const editFolder = (group: GroupData) => {
    setFolderEditor({ type: 'rename', group });
    setFolderName(group.name);
    setFolderError('');
  };
  const saveFolder = async () => {
    const name = folderName.trim();
    if (!name || !folderEditor) return;
    const res = folderEditor.type === 'create'
      ? await sendMessage({ type: 'CREATE_GROUP', payload: { name } })
      : await sendMessage({ type: 'RENAME_GROUP', payload: { id: folderEditor.group.id, name } });
    if (!res.success) { setFolderError(res.error); return; }
    setFolderEditor(null);
    await refreshGroups();
  };
  const deleteFolder = async () => {
    if (!deleteTarget) return;
    const res = await sendMessage({ type: 'DELETE_GROUP', payload: { id: deleteTarget.id } });
    if (!res.success) { setFolderError(res.error); return; }
    setActiveGroupId(null);
    setDeleteTarget(null);
    setSelectedIds(new Set());
    await Promise.all([loadEntries(), refreshGroups()]);
  };
  const moveSelected = async () => {
    const res = await sendMessage({ type: 'MOVE_ENTRIES', payload: { ids: [...selectedIds], groupId: moveTarget } });
    if (!res.success) { onSessionLost(res); return; }
    setSelectedIds(new Set());
    await loadEntries();
  };

  const allDisplayedSelected = displayedEntries.length > 0 && displayedEntries.every((entry) => selectedIds.has(entry.id));
  const toggleSelectAll = () => {
    setSelectedIds(allDisplayedSelected ? new Set() : new Set(displayedEntries.map((entry) => entry.id)));
  };
  const groupsWithChildren = new Set(groups.flatMap((group) => group.parentId ? [group.parentId] : []));
  const visibleGroups = flattenGroups(groups, collapsedGroupIds);

  const handleFill = useCallback(async (entry: EntryData) => {
    if (pageTabId == null || entry.autoFill === false) return;
    const res = await sendMessage({ type: 'FILL_IN_TAB', payload: { tabId: pageTabId, entryId: entry.id } });
    if (!res.success) onSessionLost(res);
    else window.close();
  }, [pageTabId, onSessionLost]);

  const emptyMessage = search ? 'No entries found' : activeTab === 'relevant' ? 'No entries match this site' : activeTab === 'folders' ? activeGroupId ? 'No passwords in this folder' : 'Select a folder to view its passwords' : activeTab === 'favorites' ? 'No favorite entries yet' : activeTab === 'recents' ? 'No recently used entries yet' : 'No passwords yet';

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
    {activeTab === 'folders' && <div className="border-b border-gray-200 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Folders</span>
        <button onClick={() => void addFolder()} className="text-xs text-emerald-700 hover:underline">+ New folder</button>
      </div>
      {folderEditor && <form onSubmit={(event) => { event.preventDefault(); void saveFolder(); }} className="mb-2 flex gap-1">
        <input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} aria-label="Folder name" placeholder="Folder name" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
        <button className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">Save</button>
        <button type="button" onClick={() => setFolderEditor(null)} className="px-1 text-xs text-gray-500">Cancel</button>
      </form>}
      {folderError && <p role="alert" className="mb-2 text-xs text-red-700">{folderError}</p>}
      {deleteTarget && <div className="mb-2 rounded bg-red-50 p-2 text-xs text-red-900">
        <p>Delete “{deleteTarget.name}”? Passwords go to Unfiled; subfolders move up one level.</p>
        <div className="mt-1 flex gap-2"><button onClick={() => void deleteFolder()} className="font-semibold text-red-700">Delete folder</button><button onClick={() => setDeleteTarget(null)} className="text-gray-600">Cancel</button></div>
      </div>}
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        <button onClick={() => { setActiveGroupId(UNFILED_GROUP_ID); setSelectedIds(new Set()); }} aria-pressed={activeGroupId === UNFILED_GROUP_ID} className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${activeGroupId === UNFILED_GROUP_ID ? 'bg-emerald-100 text-emerald-900' : 'text-gray-700 hover:bg-gray-100'}`}>
          <FolderIcon /><span className="flex-1">Unfiled</span>
        </button>
        {visibleGroups.map(({ group, depth }) => <div key={group.id} className={`flex items-center rounded-md pr-1 ${activeGroupId === group.id ? 'bg-emerald-100' : 'hover:bg-gray-100'}`} style={{ paddingLeft: 8 + Math.max(0, depth) * 16 }}>
          {groupsWithChildren.has(group.id)
            ? <button type="button" onClick={() => setCollapsedGroupIds((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })} aria-label={`${collapsedGroupIds.has(group.id) ? 'Expand' : 'Collapse'} ${group.name}`} aria-expanded={!collapsedGroupIds.has(group.id)} className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200">
              <svg aria-hidden="true" className={`h-3 w-3 transition-transform ${collapsedGroupIds.has(group.id) ? '' : 'rotate-90'}`} viewBox="0 0 20 20" fill="currentColor"><path d="M7 4.5 12.5 10 7 15.5l1.4 1.4L15.3 10 8.4 3.1 7 4.5Z" /></svg>
            </button>
            : <span aria-hidden="true" className="h-5 w-5 flex-shrink-0" />}
          <button onClick={() => { setActiveGroupId(group.id); setSelectedIds(new Set()); }} aria-pressed={activeGroupId === group.id} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs ${activeGroupId === group.id ? 'text-emerald-900' : 'text-gray-700'}`}>
            <FolderIcon /><span className="truncate">{group.name}</span>
          </button>
          <button title={`Rename ${group.name}`} aria-label={`Rename ${group.name}`} onClick={() => editFolder(group)} className="px-1 text-xs text-gray-400 hover:text-gray-700">✎</button>
          <button title={`Delete ${group.name}`} aria-label={`Delete ${group.name}`} onClick={() => setDeleteTarget(group)} className="px-1 text-xs text-gray-400 hover:text-red-600">×</button>
        </div>)}
        {activeGroupId && activeGroupId !== UNFILED_GROUP_ID && <button onClick={() => setActiveGroupId(null)} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-100">Clear folder selection</button>}
      </div>
    </div>}
    {(activeTab === 'all' || activeTab === 'folders') && <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5">
      <span className="text-xs text-gray-500">{displayedEntries.length} passwords</span>
      <button type="button" onClick={toggleSelectAll} disabled={displayedEntries.length === 0} className="text-xs font-medium text-emerald-700 hover:underline disabled:text-gray-400 disabled:no-underline">{allDisplayedSelected ? 'Deselect all' : 'Select all'}</button>
    </div>}
    {selectedIds.size > 0 && <div className="flex items-center gap-2 border-b border-gray-200 bg-emerald-50 px-3 py-2">
      <span className="text-xs font-medium text-emerald-900">{selectedIds.size} selected</span>
      <select aria-label="Move selected passwords to folder" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs">
        <option value="">Unfiled</option>{groups.filter((group) => group.parentId !== null).map((group) => <option key={group.id} value={group.id}>{'　'.repeat(Math.max(0, groupDepth(group, groups) - 1))}{group.name}</option>)}
      </select>
      <button onClick={() => void moveSelected()} className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">Move</button>
      <button onClick={() => setSelectedIds(new Set())} aria-label="Clear selection" className="text-xs text-gray-500">Cancel</button>
    </div>}
    <div className="flex-1 overflow-y-auto">
      {loading ? <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" /></div>
        : displayedEntries.length === 0 ? <div className="text-center py-12 px-4"><p className="text-gray-500 text-sm">{emptyMessage}</p>{activeTab === 'all' && !search && <p className="text-gray-400 text-xs mt-1">Click + to add your first entry</p>}</div>
          : <div className={`divide-y ${themeMode === 'dark' ? 'divide-gray-600' : 'divide-gray-100'}`}>{displayedEntries.map((entry) => {
            const canFill = activeTab === 'relevant' && entry.autoFill !== false;
            const canEdit = activeTab === 'relevant' || activeTab === 'all';
            const item = <>
              {activeTab !== 'relevant' && <input type="checkbox" checked={selectedIds.has(entry.id)} aria-label={`Select ${displayTitle(entry)}`} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} className="h-4 w-4 accent-emerald-600" />}
              <DomainIcon url={entry.url} />
              <div className="flex-1 min-w-0">
                <div className="flex min-w-0 items-center gap-1">
                  <p className="min-w-0 truncate text-sm font-medium text-gray-800">{displayTitle(entry)} {entry.favorite && <span className="text-amber-500" aria-label="Favorite">★</span>}</p>
                  {breachedEntryIds.has(entry.id) && <span role="img" aria-label="Password appears in known breach data" title="Password appears in known breach data" className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold leading-none text-red-700">!</span>}
                </div>
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

function groupDepth(group: GroupData, groups: GroupData[]): number {
  let depth = 0;
  let current: GroupData | undefined = group;
  const byId = new Map(groups.map((item) => [item.id, item]));
  while (current?.parentId) { depth++; current = byId.get(current.parentId); }
  return depth;
}

function flattenGroups(groups: GroupData[], collapsedGroupIds: Set<string>): Array<{ group: GroupData; depth: number }> {
  const children = new Map<string | null, GroupData[]>();
  for (const group of groups) {
    const siblings = children.get(group.parentId) ?? [];
    siblings.push(group);
    children.set(group.parentId, siblings);
  }
  const flattened: Array<{ group: GroupData; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const group of children.get(parentId) ?? []) {
      flattened.push({ group, depth });
      if (!collapsedGroupIds.has(group.id)) visit(group.id, depth + 1);
    }
  };
  visit(null, 0);
  return flattened;
}

function FolderIcon() {
  return <svg aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-sky-600" viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h4.2c.5 0 .9.2 1.2.6l1.1 1.3H19A2 2 0 0 1 21 8v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11a1 1 0 0 1 .5-1Z" /></svg>;
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
