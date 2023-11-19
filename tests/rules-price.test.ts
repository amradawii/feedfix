import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { parsePriceValue, runRules } from '../src/core/rules';

function runOnCsv(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  return runRules(parsed, catalog);
}

describe('price rules', () => {
  it('converts Arabic-Indic digits safely for Shopify and Google', () => {
    const shopify = runOnCsv('Handle,Title,Variant Price\nkaftan-1,قفطان,٨٥٠');
    const sp = shopify.problems.find((p) => p.ruleId === 'price.arabic-digits');
    expect(sp?.fix?.safe).toBe(true);
    expect(sp?.fix?.edits[0].after).toBe('850.00');

    const google = runOnCsv(
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\nG1\tحقيبة\tوصف\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t٤٥٠ EGP',
    );
    const gp = google.problems.find((p) => p.ruleId === 'price.arabic-digits');
    expect(gp?.fix?.safe).toBe(true);
    expect(gp?.fix?.edits[0].after).toBe('450.00 EGP');
  });

  it('normalizes currency text and thousands separators in Shopify/WooCommerce prices', () => {
    const res = runOnCsv('Handle,Title,Variant Price\nshirt-1,Shirt,"1,200 EGP"');
    const p = res.problems.find((x) => x.ruleId === 'price.text-or-currency');
    expect(p?.message).toBe('Price has text in it: 1,200 EGP');
    expect(p?.fix?.safe).toBe(true);
    expect(p?.fix?.edits[0].after).toBe('1200.00');
  });

  it('fixes European decimal commas safely without floating-point errors', () => {
    const res = runOnCsv('ID;Type;SKU;Name;Regular price;In stock?\n1;simple;S1;Mug;1.200,50;1');
    const p = res.problems.find((x) => x.ruleId === 'price.decimal-comma');
    expect(p?.fix?.safe).toBe(true);
    expect(p?.fix?.edits[0].after).toBe('1200.50');

    const parsed = parsePriceValue('19,99');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.normalizedNumber).toBe('19.99');
      expect(parsed.scaledUnits).toBe(199900n);
    }
  });

  it('flags invalid, negative, and zero prices without auto-fixing', () => {
    const csv = [
      'Handle,Title,Variant Price',
      'a-1,Bad,Call for price',
      'a-2,Neg,-15.00',
      'a-3,Zero,0.00',
    ].join('\n');
    const res = runOnCsv(csv);
    const inv = res.problems.find((p) => p.ruleId === 'price.invalid');
    const neg = res.problems.find((p) => p.ruleId === 'price.negative');
    const zero = res.problems.find((p) => p.ruleId === 'price.zero');

    expect(inv?.row).toBe(2);
    expect(inv?.fix).toBeUndefined();
    expect(neg?.row).toBe(3);
    expect(neg?.fix).toBeUndefined();
    expect(zero?.row).toBe(4);
    expect(zero?.fix).toBeUndefined();
  });

  it('flags missing ISO currency on Google feeds and never guesses from "$"', () => {
    const csv = [
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice',
      'G1\tShoes\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t89.00',
      'G2\tHat\tDesc\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t$19.99',
    ].join('\n');
    const res = runOnCsv(csv);
    const missing = res.problems.filter((p) => p.ruleId === 'price.missing-currency');
    expect(missing).toHaveLength(2);
    expect(missing.every((m) => m.fix === undefined)).toBe(true);
  });

  it('flags sale price >= regular price and offers an opt-in swap (safe: false)', () => {
    // Shopify: Variant Price (1500.00) is higher than Variant Compare At Price (1200.00)
    const shopify = runOnCsv(
      'Handle,Title,Variant Price,Variant Compare At Price\nshirt-1,Shirt,1500.00,1200.00',
    );
    const sp = shopify.problems.find((p) => p.ruleId === 'price.sale-gte-regular');
    expect(sp).toBeDefined();
    expect(sp?.fix?.safe).toBe(false);
    expect(sp?.fix?.edits).toEqual([
      {
        row: 2,
        col: 3,
        columnName: 'Variant Compare At Price',
        before: '1200.00',
        after: '1500.00',
      },
      {
        row: 2,
        col: 2,
        columnName: 'Variant Price',
        before: '1500.00',
        after: '1200.00',
      },
    ]);

    // WooCommerce: Sale price equal to Regular price -> flagged with no swap
    const woo = runOnCsv(
      'ID;Type;SKU;Name;Regular price;Sale price;In stock?\n1;simple;S1;Mug;40.00;40.00;1',
    );
    const wp = woo.problems.find((p) => p.ruleId === 'price.sale-gte-regular');
    expect(wp).toBeDefined();
    expect(wp?.fix).toBeUndefined();
  });
});
