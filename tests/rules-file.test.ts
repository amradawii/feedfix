import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { runRules } from '../src/core/rules';

function runOnCsv(csv: string | Uint8Array) {
  const bytes = typeof csv === 'string' ? new TextEncoder().encode(csv) : csv;
  const parsed = parseCsvBytes(bytes);
  const catalog = readCatalog(parsed);
  return runRules(parsed, catalog);
}

describe('file rules', () => {
  it('flags non-UTF-8 encoding conversion as a tip', () => {
    const header = new TextEncoder().encode('Handle,Title,Variant Price\nshirt-1,');
    const arabicWin1256 = new Uint8Array([0xc7, 0xe1, 0xde, 0xe3, 0xed, 0xd5]); // القميص
    const tail = new TextEncoder().encode(',100.00\n');
    const bytes = new Uint8Array(header.length + arabicWin1256.length + tail.length);
    bytes.set(header, 0);
    bytes.set(arabicWin1256, header.length);
    bytes.set(tail, header.length + arabicWin1256.length);

    const res = runOnCsv(bytes);
    expect(res.problems.some((p) => p.ruleId === 'file.encoding-converted')).toBe(true);
  });

  it('detects Arabic mojibake and proposes a safe repair', () => {
    const mojibake = new TextDecoder('windows-1252').decode(
      new TextEncoder().encode('القفطان الكتان'),
    );
    const res = runOnCsv(`Handle,Title,Variant Price\nkaf-1,${mojibake},250.00`);
    const p = res.problems.find((x) => x.ruleId === 'file.mojibake');
    expect(p).toBeDefined();
    expect(p?.fix?.safe).toBe(true);
    expect(p?.fix?.edits[0].after).toBe('القفطان الكتان');
  });

  it('flags unrecoverable ??? corruption without a fix', () => {
    const res = runOnCsv('Handle,Title,Variant Price\nlamp-1,?????? ?????,80.00');
    const p = res.problems.find((x) => x.ruleId === 'file.unrecoverable-question-marks');
    expect(p).toBeDefined();
    expect(p?.fix).toBeUndefined();
  });

  it('flags semicolon delimiter for Shopify/WooCommerce but allows tab for Google', () => {
    const woo = runOnCsv('ID;Type;SKU;Name;Regular price;In stock?\n1;simple;S1;Mug;12.00;1');
    expect(woo.problems.some((p) => p.ruleId === 'file.non-comma-delimiter')).toBe(true);

    const gmc = runOnCsv(
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\nG1\tMug\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t12.00 USD',
    );
    expect(gmc.problems.some((p) => p.ruleId === 'file.non-comma-delimiter')).toBe(false);
  });

  it('flags duplicate headers, empty headers, and ragged rows', () => {
    const csv = [
      'Handle,Title,,Variant Price,Title',
      'a-1,Shirt,,15.00,Extra',
      'a-2,Pants,,20.00',
    ].join('\n');
    const res = runOnCsv(csv);
    expect(res.problems.some((p) => p.ruleId === 'file.duplicate-header')).toBe(true);
    expect(res.problems.some((p) => p.ruleId === 'file.empty-header')).toBe(true);
    expect(res.problems.some((p) => p.ruleId === 'file.ragged-row' && p.row === 3)).toBe(true);
  });

  it('detects zero-width and NBSP invisible characters with a safe fix', () => {
    const csv = `Handle,Title,Variant Price\na-1,Cotton\u200BShirt\u00A0Blue,25.00`;
    const res = runOnCsv(csv);
    const p = res.problems.find((x) => x.ruleId === 'file.invisible-chars');
    expect(p).toBeDefined();
    expect(p?.fix?.safe).toBe(true);
    expect(p?.fix?.edits[0].after).toBe('CottonShirt Blue');
  });
});
