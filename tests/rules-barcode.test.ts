import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { isValidGs1CheckDigit, runRules, tryRestoreLeadingZero } from '../src/core/rules';

function runOnCsv(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  return runRules(parsed, catalog);
}

describe('barcode rules', () => {
  it('validates GS1 check digits for 8, 12, 13, and 14-digit codes', () => {
    expect(isValidGs1CheckDigit('01234565')).toBe(true); // EAN-8
    expect(isValidGs1CheckDigit('036000291452')).toBe(true); // UPC-A
    expect(isValidGs1CheckDigit('4006381333931')).toBe(true); // EAN-13
    expect(isValidGs1CheckDigit('10012345678902')).toBe(true); // GTIN-14

    expect(isValidGs1CheckDigit('4006381333939')).toBe(false);
    expect(isValidGs1CheckDigit('000000000000')).toBe(false); // all-same rejected
  });

  it('flags scientific notation barcodes as unrecoverable with no fix', () => {
    const res = runOnCsv('Handle,Title,Variant Price,Variant Barcode\na-1,Shirt,10.00,6.29E+12');
    const p = res.problems.find((x) => x.ruleId === 'barcode.scientific-notation');
    expect(p).toBeDefined();
    expect(p?.severity).toBe('fail');
    expect(p?.fix).toBeUndefined();
  });

  it('rejects all-same-digit barcodes even when checksum math equals zero', () => {
    const res = runOnCsv(
      'Handle,Title,Variant Price,Variant Barcode\na-1,Shirt,10.00,000000000000',
    );
    const p = res.problems.find((x) => x.ruleId === 'barcode.all-same-digits');
    expect(p).toBeDefined();
    expect(p?.fix).toBeUndefined();
    expect(res.problems.some((x) => x.ruleId === 'barcode.invalid-check-digit')).toBe(false);
  });

  it('restores lost leading zeros from 11->12 and 7->8 only when check digit proves it, never 12->13', () => {
    expect(tryRestoreLeadingZero('36000291452')).toBe('036000291452'); // 11 -> 12 UPC-A
    expect(tryRestoreLeadingZero('1234565')).toBe('01234565'); // 7 -> 8 EAN-8
    expect(tryRestoreLeadingZero('36000291459')).toBeNull(); // bad check digit -> do not restore
    expect(tryRestoreLeadingZero('036000291452')).toBeNull(); // 12-digit NEVER turned into 13

    const csv = [
      'Handle,Title,Variant Price,Variant Barcode',
      'a-1,UPC,10.00,36000291452',
      'a-2,EAN8,10.00,1234565',
      'a-3,Valid12,10.00,036000291452',
    ].join('\n');
    const res = runOnCsv(csv);
    const restored = res.problems.filter((p) => p.ruleId === 'barcode.lost-leading-zero');
    expect(restored).toHaveLength(2);
    expect(restored[0].fix?.safe).toBe(true);
    expect(restored[0].fix?.edits[0].after).toBe('036000291452');
    expect(restored[1].fix?.edits[0].after).toBe('01234565');
    // Valid 12-digit UPC must produce zero barcode problems
    expect(res.problems.filter((p) => p.row === 4)).toHaveLength(0);
  });

  it('flags invalid barcode length, non-digit characters, and wrong check digits', () => {
    const csv = [
      'Handle,Title,Variant Price,Variant Barcode',
      'a-1,Short,10.00,123456',
      'a-2,Letters,10.00,ABC-12345678',
      'a-3,BadCheck,10.00,4006381333939',
    ].join('\n');
    const res = runOnCsv(csv);
    expect(res.problems.some((p) => p.ruleId === 'barcode.invalid-length' && p.row === 2)).toBe(
      true,
    );
    expect(res.problems.some((p) => p.ruleId === 'barcode.invalid-length' && p.row === 3)).toBe(
      true,
    );
    const badCheck = res.problems.find(
      (p) => p.ruleId === 'barcode.invalid-check-digit' && p.row === 4,
    );
    expect(badCheck?.message).toContain('expected last digit 1');
    expect(badCheck?.fix).toBeUndefined();
  });
});
