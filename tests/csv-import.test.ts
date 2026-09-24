import { describe, expect, it } from 'vitest';
import { inferTitle, normalizeCsvUrl, parseCsv, suggestCsvMapping } from '@/lib/csv-import';

describe('CSV import helpers', () => {
  it('parses a BOM-prefixed CSV with escaped quotes, commas, and embedded newlines', () => {
    const csv = '\uFEFFname,username,password,url,notes\r\n"Work, mail",alice,"p""ass",https://mail.example.com,"line one\nline two"\r\n';

    expect(parseCsv(csv)).toEqual({
      headers: ['name', 'username', 'password', 'url', 'notes'],
      rows: [['Work, mail', 'alice', 'p"ass', 'https://mail.example.com', 'line one\nline two']],
    });
  });

  it('rejects an unclosed quoted field and CSV without a data row', () => {
    expect(() => parseCsv('name,password\n"unfinished,secret')).toThrow('unclosed quoted field');
    expect(() => parseCsv('name,password\n')).toThrow('header and at least one data row');
  });

  it('suggests mappings from common password manager headers', () => {
    expect(suggestCsvMapping(['Name', 'Login Username', 'Login Password', 'Website URL', 'Extra'])).toEqual({
      title: 0,
      username: 1,
      password: 2,
      url: 3,
      notes: 4,
    });
  });

  it('infers a title from the hostname or username when the title is missing', () => {
    expect(inferTitle('https://www.example.com/login', 'alice')).toBe('www.example.com');
    expect(inferTitle('', 'alice@example.com')).toBe('alice@example.com');
    expect(inferTitle('', '')).toBe('Imported login');
  });

  it('normalizes URLs for duplicate matching', () => {
    expect(normalizeCsvUrl('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeCsvUrl('www.example.com/')).toBe('example.com');
    expect(normalizeCsvUrl('')).toBe('');
  });
});
