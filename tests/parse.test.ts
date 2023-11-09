import { describe, expect, it } from 'vitest';
import { CsvLimitError, detectDelimiter, MAX_FILE_BYTES, parseCsvBytes } from '../src/core/parse';

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('delimiter detection and CSV parsing', () => {
  it('detects comma, semicolon, and tab delimiters', () => {
    expect(detectDelimiter('Handle,Title,Price\nshirt-1,Shirt,10.00').delimiter).toBe(',');
    expect(detectDelimiter('Handle;Title;Price\nshirt-1;Shirt;10,00').delimiter).toBe(';');
    expect(detectDelimiter('id\ttitle\tprice\n101\tCotton Shirt\t15.00 USD').delimiter).toBe('\t');
  });

  it('ignores delimiters inside quoted fields when detecting delimiter', () => {
    const csv = [
      'Handle;Title;Description;Price',
      'a-1;"Shirt, Blue, Large";"Soft, breathable, cotton";250',
      'a-2;"Hat, Red, Small";"Light, durable";120',
    ].join('\n');
    expect(detectDelimiter(csv).delimiter).toBe(';');

    const parsed = parseCsvBytes(toBytes(csv));
    expect(parsed.delimiter).toBe(';');
    expect(parsed.delimiterLabel).toBe('semicolon');
    expect(parsed.headers).toEqual(['Handle', 'Title', 'Description', 'Price']);
    expect(parsed.rows).toEqual([
      ['a-1', 'Shirt, Blue, Large', 'Soft, breathable, cotton', '250'],
      ['a-2', 'Hat, Red, Small', 'Light, durable', '120'],
    ]);
  });

  it('preserves newlines inside quoted cells and trims trailing blank lines', () => {
    const csv = [
      'Handle,Title,Body (HTML),Variant Price',
      'mug-1,"Ceramic Mug","<p>Line 1',
      'Line 2',
      'Line 3</p>",12.50',
      'mug-2,"Travel Mug","<p>Single line</p>",18.00',
      '',
    ].join('\n');

    const parsed = parseCsvBytes(toBytes(csv));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0][2]).toBe('<p>Line 1\nLine 2\nLine 3</p>');
    expect(parsed.rows[1][0]).toBe('mug-2');
    expect(parsed.raggedRows).toHaveLength(0);
  });

  it('records ragged rows with 1-based spreadsheet row numbers', () => {
    const csv = ['Handle,Title,Price', 'a-1,Shirt,10.00', 'a-2,Pants', 'a-3,Hat,12.00,EXTRA'].join(
      '\n',
    );

    const parsed = parseCsvBytes(toBytes(csv));
    expect(parsed.raggedRows).toEqual([
      { row: 3, expected: 3, actual: 2 },
      { row: 4, expected: 3, actual: 4 },
    ]);
  });

  it('rejects empty files and files above 50 MB', () => {
    expect(() => parseCsvBytes(new Uint8Array(0))).toThrow(CsvLimitError);

    const oversized = new Uint8Array(MAX_FILE_BYTES + 1);
    expect(() => parseCsvBytes(oversized)).toThrow(/50 MB/);
  });

  it('supports manual delimiter override', () => {
    const csv = 'a;b;c\n1;2;3';
    const parsed = parseCsvBytes(toBytes(csv), { delimiter: ',' });
    expect(parsed.delimiter).toBe(',');
    expect(parsed.headers).toEqual(['a;b;c']);
  });
});
