export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export type CsvField = 'title' | 'username' | 'password' | 'url' | 'notes';
export type CsvMapping = Record<CsvField, number | null>;

const aliases: Record<CsvField, string[]> = {
  title: ['title', 'name', 'entry', 'item', 'website', 'account name'],
  username: ['username', 'user name', 'login', 'login username', 'email', 'user'],
  password: ['password', 'login password', 'pass'],
  url: ['url', 'website url', 'uri', 'website', 'hostname'],
  notes: ['notes', 'note', 'extra', 'comments', 'description'],
};

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

/** Parse RFC 4180 style CSV including escaped quotes, embedded commas and newlines. */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const nonempty = rows.filter((values) => values.some((value) => value.trim()));
  if (nonempty.length < 2) throw new Error('The CSV must include a header and at least one data row.');
  const headers = nonempty[0].map((header) => header.trim());
  return { headers, rows: nonempty.slice(1).map((values) => headers.map((_, index) => values[index] ?? '')) };
}

export function suggestCsvMapping(headers: string[]): CsvMapping {
  const normalized = headers.map(normalizeHeader);
  const find = (field: CsvField): number | null => {
    const index = normalized.findIndex((header) => aliases[field].includes(header));
    return index < 0 ? null : index;
  };
  return { title: find('title'), username: find('username'), password: find('password'), url: find('url'), notes: find('notes') };
}

export function inferTitle(url: string, username: string): string {
  if (url.trim()) {
    try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname; }
    catch { return url.trim(); }
  }
  return username.trim() || 'Imported login';
}

export function normalizeCsvUrl(url: string): string {
  const value = url.trim().toLowerCase();
  if (!value) return '';
  try { return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.replace(/^www\./, ''); }
  catch { return value.replace(/^www\./, '').replace(/\/$/, ''); }
}
