import { describe, expect, it } from 'vitest';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { loadGoogleTaxonomy, runRules, runRulesAsync } from '../src/core/rules';
import { SAMPLE_FEEDS } from '../src/samples';

function runOnCsv(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  return runRules(parsed, catalog);
}

async function runOnCsvAsync(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  return runRulesAsync(parsed, catalog);
}

describe('required rules per platform', () => {
  it('flags missing required Shopify columns and blank variant defaults', () => {
    const missingCol = runOnCsv('Handle,Title,Body (HTML)\na-1,Shirt,<p>Hi</p>');
    expect(
      missingCol.problems.some(
        (p) => p.ruleId === 'required.missing-column' && p.columnName === 'Variant Price',
      ),
    ).toBe(true);

    const missingDefaults = runOnCsv(
      'Handle,Title,Variant Price,Variant Inventory Policy,Variant Fulfillment Service\na-1,Shirt,20.00,,',
    );
    const defs = missingDefaults.problems.filter(
      (p) => p.ruleId === 'required.shopify-variant-defaults',
    );
    expect(defs).toHaveLength(2);
  });

  it('enforces Google availability_date for preorder and backorder', () => {
    const csv = [
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tavailability_date\tprice\tbrand\tgtin',
      'G1\tShoes\tNice shoes\thttps://example.com/1\thttps://example.com/1.jpg\tbackorder\t\t89.00 USD\tPeak\t4006381333931',
      'G2\tBoots\tWarm boots\thttps://example.com/2\thttps://example.com/2.jpg\tpreorder\tsoon\t99.00 USD\tPeak\t036000291452',
      'G3\tCoat\tWinter coat\thttps://example.com/3\thttps://example.com/3.jpg\tpreorder\t2023-12-15T00:00+00:00\t120.00 USD\tPeak\t01234565',
    ].join('\n');
    const res = runOnCsv(csv);
    const dateIssues = res.problems.filter((p) => p.ruleId === 'required.google-availability-date');
    expect(dateIssues).toHaveLength(2);
    expect(dateIssues.map((d) => d.row)).toEqual([2, 3]);
  });

  it('handles Google identifier_exists=no cleanly and flags conflicts', () => {
    const csv = [
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\tbrand\tgtin\tmpn\tidentifier_exists',
      'G1\tHandmade Rug\tWool rug\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t200.00 USD\t\t\t\tno',
      'G2\tConflict Item\tDesc\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t50.00 USD\tBrandX\t4006381333931\t\tno',
      'G3\tBranded No GTIN\tDesc\thttps://example.com/3\thttps://example.com/3.jpg\tin_stock\t50.00 USD\t\t\t\tyes',
    ].join('\n');
    const res = runOnCsv(csv);
    const idIssues = res.problems.filter((p) => p.ruleId === 'required.google-identifiers');
    // Row 2 (G1) must have ZERO identifier issues
    expect(idIssues.filter((p) => p.row === 2)).toHaveLength(0);
    // Row 3 (G2) has conflict (identifier_exists=no with GTIN)
    expect(idIssues.filter((p) => p.row === 3)).toHaveLength(1);
    // Row 4 (G3) is missing brand and gtin/mpn
    expect(idIssues.filter((p) => p.row === 4)).toHaveLength(2);
  });
});

describe('text, link, variant, value and category rules', () => {
  it('checks HTML in titles, ALL CAPS, length limits, promo words, and trims whitespace safely', () => {
    const longTitle = 'A'.repeat(160).toLowerCase();
    const csv = [
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\tbrand\tgtin',
      'G1\t<b>Cotton Shirt</b>\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t20.00 USD\tNile\t4006381333931',
      'G2\tCOTTON  SHIRT FREE SHIPPING\tDesc\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t20.00 USD\tNile\t036000291452',
      `G3\t${longTitle}\tDesc\thttps://example.com/3\thttps://example.com/3.jpg\tin_stock\t20.00 USD\tNile\t01234565`,
    ].join('\n');
    const res = runOnCsv(csv);

    expect(res.problems.some((p) => p.ruleId === 'text.html-in-title' && p.row === 2)).toBe(true);
    expect(res.problems.some((p) => p.ruleId === 'text.all-caps-title' && p.row === 3)).toBe(true);
    expect(res.problems.some((p) => p.ruleId === 'text.google-promo-title' && p.row === 3)).toBe(
      true,
    );
    const ws = res.problems.find((p) => p.ruleId === 'text.whitespace' && p.row === 3);
    expect(ws?.fix?.safe).toBe(true);
    expect(ws?.fix?.edits[0].after).toBe('COTTON SHIRT FREE SHIPPING');
    expect(res.problems.some((p) => p.ruleId === 'text.length-limit' && p.row === 4)).toBe(true);
  });

  it('checks URL rules: relative fails, http:// is a tip with no fix, spaces are safely encoded', () => {
    const csv = [
      'Handle,Title,Variant Price,Image Src',
      'a-1,Relative,10.00,/images/a.jpg',
      'a-2,PlainHttp,10.00,http://example.com/a.jpg',
      'a-3,Spaces,10.00,https://example.com/my image.jpg',
      'a-4,MissingImg,10.00,',
    ].join('\n');
    const res = runOnCsv(csv);

    const rel = res.problems.find((p) => p.ruleId === 'links.invalid-url' && p.row === 2);
    expect(rel?.severity).toBe('fail');
    expect(rel?.fix).toBeUndefined();

    const http = res.problems.find((p) => p.ruleId === 'links.http-url' && p.row === 3);
    expect(http?.severity).toBe('tip');
    expect(http?.fix).toBeUndefined();

    const spaces = res.problems.find((p) => p.ruleId === 'links.spaces-in-url' && p.row === 4);
    expect(spaces?.fix?.safe).toBe(true);
    expect(spaces?.fix?.edits[0].after).toBe('https://example.com/my%20image.jpg');

    expect(res.problems.some((p) => p.ruleId === 'links.missing-image' && p.row === 5)).toBe(true);
  });

  it('checks variant structure rules across Shopify, WooCommerce, and Google', () => {
    const shopifyMissingOpt = runOnCsv(
      [
        'Handle,Title,Option1 Name,Option1 Value,Variant Price',
        'shirt-1,Shirt,Size,Small,20.00',
        'shirt-1,,, ,20.00',
      ].join('\n'),
    );
    expect(
      shopifyMissingOpt.problems.some((p) => p.ruleId === 'variants.shopify-missing-option'),
    ).toBe(true);

    const wooOrphan = runOnCsv(
      'ID;Type;SKU;Name;Regular price;Parent;In stock?\n2;variation;V1;Orphan;15.00;NO-PARENT;1',
    );
    expect(wooOrphan.problems.some((p) => p.ruleId === 'variants.woo-orphan-variation')).toBe(true);

    const googleMissingGroup = runOnCsv(
      [
        'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\tcolor\tsize',
        'G1\tCrew Tee\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t20.00 USD\tBlue\tS',
        'G2\tCrew Tee\tDesc\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t20.00 USD\tBlue\tM',
      ].join('\n'),
    );
    expect(
      googleMissingGroup.problems.some((p) => p.ruleId === 'variants.google-missing-item-group-id'),
    ).toBe(true);
  });

  it('normalizes allowed enum values safely across all three platforms', () => {
    const google = runOnCsv(
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\tcondition\tidentifier_exists\nG1\tTee\tDesc\thttps://example.com/1\thttps://example.com/1.jpg\tIn Stock\t20.00 USD\tNEW\tTRUE',
    );
    expect(
      google.problems.find((p) => p.ruleId === 'values.google-availability')?.fix?.edits[0].after,
    ).toBe('in_stock');
    expect(
      google.problems.find((p) => p.ruleId === 'values.google-condition')?.fix?.edits[0].after,
    ).toBe('new');
    expect(
      google.problems.find((p) => p.ruleId === 'values.google-identifier-exists')?.fix?.edits[0]
        .after,
    ).toBe('yes');

    const shopify = runOnCsv(
      'Handle,Title,Variant Price,Status,Published,Variant Inventory Policy\na-1,Tee,20.00,Active,true,DENY',
    );
    expect(
      shopify.problems.find((p) => p.ruleId === 'values.shopify-status')?.fix?.edits[0].after,
    ).toBe('active');
    expect(
      shopify.problems.find((p) => p.ruleId === 'values.shopify-published')?.fix?.edits[0].after,
    ).toBe('TRUE');
    expect(
      shopify.problems.find((p) => p.ruleId === 'values.shopify-inventory-policy')?.fix?.edits[0]
        .after,
    ).toBe('deny');

    const woo = runOnCsv(
      'ID;Type;SKU;Name;Published;In stock?;Regular price\n1;simple;S1;Mug;true;In Stock;15.00',
    );
    expect(woo.problems.find((p) => p.ruleId === 'values.woo-published')?.fix?.edits[0].after).toBe(
      '1',
    );
    expect(woo.problems.find((p) => p.ruleId === 'values.woo-in-stock')?.fix?.edits[0].after).toBe(
      '1',
    );
  });

  it('lazy-loads the official 2021-09-21 Google Product Taxonomy and validates IDs and full paths', async () => {
    const taxonomy = await loadGoogleTaxonomy();
    expect(taxonomy.version).toBe('2021-09-21');
    expect(taxonomy.size).toBeGreaterThan(5000);
    expect(taxonomy.isValid('212')).toBe(true);
    expect(taxonomy.isValid('Apparel & Accessories > Clothing > Shirts & Tops')).toBe(true);
    expect(taxonomy.isValid('999999')).toBe(false);

    const googleSample = SAMPLE_FEEDS.find((s) => s.id === 'google')!;
    const res = await runOnCsvAsync(googleSample.content);
    const catIssues = res.problems.filter((p) => p.ruleId === 'category.google-taxonomy');
    // Sample has valid IDs (212, 187, 598, 674) and one invalid ID (999999 on row 5)
    expect(catIssues).toHaveLength(1);
    expect(catIssues[0].rawValue).toBe('999999');
  });
});
