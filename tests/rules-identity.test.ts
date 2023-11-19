import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { runRules } from '../src/core/rules';

function runOnCsv(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  return runRules(parsed, catalog);
}

describe('identity rules', () => {
  it('flags every row in a duplicate SKU group', () => {
    const csv = [
      'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price',
      'shirt-1,Shirt One,Title,Default Title,DUP-01,25.00',
      'shirt-2,Shirt Two,Title,Default Title,dup-01,30.00',
      'shirt-3,Shirt Three,Title,Default Title,UNIQ-03,35.00',
    ].join('\n');
    const res = runOnCsv(csv);
    const dups = res.problems.filter((p) => p.ruleId === 'identity.duplicate-sku');
    expect(dups).toHaveLength(2);
    expect(dups.map((d) => d.row)).toEqual([2, 3]);
    expect(dups[0].fix).toBeUndefined();
  });

  it('flags duplicate Google product IDs', () => {
    const csv = [
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice',
      'G-1\tMug A\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t10.00 USD',
      'G-1\tMug B\tDesc\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t12.00 USD',
    ].join('\n');
    const res = runOnCsv(csv);
    const dups = res.problems.filter((p) => p.ruleId === 'identity.duplicate-id');
    expect(dups).toHaveLength(2);
    expect(dups.map((d) => d.row)).toEqual([2, 3]);
  });

  it('flags non-contiguous Shopify handles', () => {
    const csv = [
      'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price',
      'shirt-a,Shirt A,Size,S,A-S,20.00',
      'shirt-b,Shirt B,Title,Default Title,B-1,25.00',
      'shirt-a,,Size,M,A-M,20.00',
    ].join('\n');
    const res = runOnCsv(csv);
    const handleIssues = res.problems.filter((p) => p.ruleId === 'identity.duplicate-handle');
    expect(handleIssues).toHaveLength(1);
    expect(handleIssues[0].row).toBe(4);
  });

  it('flags empty SKUs on multi-variant products', () => {
    const csv = [
      'Handle,Title,Option1 Name,Option1 Value,Variant SKU,Variant Price',
      'shirt-a,Shirt A,Size,S,A-S,20.00',
      'shirt-a,,Size,M,,20.00',
    ].join('\n');
    const res = runOnCsv(csv);
    const emptySku = res.problems.filter((p) => p.ruleId === 'identity.empty-variant-sku');
    expect(emptySku).toHaveLength(1);
    expect(emptySku[0].row).toBe(3);
  });
});
