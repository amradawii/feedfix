import { describe, expect, it } from 'vitest';
import { analyzeConversion, detectUnambiguousCurrency } from '../src/core/convert';
import { exportCatalog, serializeChangeLogCsv, serializeCsv } from '../src/core/export';
import { acceptSafeFixes, applyFixes, buildFixPlan } from '../src/core/fixes';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { runRules } from '../src/core/rules';
import { SAMPLE_FEEDS } from '../src/samples';

function parseString(text: string) {
  return parseCsvBytes(new TextEncoder().encode(text));
}

describe('platform conversion and RFC 4180 export', () => {
  it('round-trips Shopify -> model -> Shopify preserving variants, prices, barcodes, and extra images', () => {
    const shopifySample = SAMPLE_FEEDS.find((s) => s.id === 'shopify')!;
    const parsed = parseString(shopifySample.content);
    const catalog = readCatalog(parsed);
    const rules = runRules(parsed, catalog);
    const fixed = applyFixes(parsed, acceptSafeFixes(buildFixPlan(rules.problems)));
    const fixedCatalog = readCatalog(fixed.parsed, 'shopify');

    const exported = exportCatalog({
      parsed: fixed.parsed,
      catalog: fixedCatalog,
      target: 'shopify',
    });

    const reparsed = parseCsvBytes(exported.bytes);
    const recatalog = readCatalog(reparsed, 'shopify');

    expect(recatalog.products).toHaveLength(5);
    const oxford = recatalog.products[0];
    expect(oxford.variants).toHaveLength(3);
    expect(oxford.images).toHaveLength(2);
    // Variant 1 on sale: Variant Price = 1200.00, Variant Compare At Price = 1450.00
    expect(oxford.variants[0].regularPrice?.value).toBe('1450.00');
    expect(oxford.variants[0].salePrice?.value).toBe('1200.00');
    // Variant 2 restored barcode preserved as string with leading zero
    expect(oxford.variants[1].barcode?.value).toBe('036000291452');
    // Arabic title repaired & preserved
    expect(recatalog.products[1].title?.value).toBe('القميص الكتان');
    expect(recatalog.products[1].variants[0].isDefaultVariant).toBe(true);
  });

  it('converts WooCommerce variable products -> Shopify with options, variants, and non-inverted prices', () => {
    const wooSample = SAMPLE_FEEDS.find((s) => s.id === 'woocommerce')!;
    const parsed = parseString(wooSample.content);
    const catalog = readCatalog(parsed, 'woocommerce');
    const rules = runRules(parsed, catalog);
    const fixed = applyFixes(parsed, acceptSafeFixes(buildFixPlan(rules.problems)));
    const fixedCatalog = readCatalog(fixed.parsed, 'woocommerce');

    const exported = exportCatalog({
      parsed: fixed.parsed,
      catalog: fixedCatalog,
      target: 'shopify',
    });

    const shopifyParsed = parseCsvBytes(exported.bytes);
    const shopifyCatalog = readCatalog(shopifyParsed, 'shopify');

    const shirt = shopifyCatalog.products[0];
    expect(shirt.title?.value).toBe('Linen Summer Shirt');
    expect(shirt.vendor?.value).toBe('Nile Craft');
    expect(shirt.variants).toHaveLength(2);
    expect(shirt.variants[0].sku?.value).toBe('WC-SHIRT-M');
    // Woo Regular 49.90 / Sale 39.90 -> Shopify Compare At 49.90 / Variant Price 39.90
    expect(shirt.variants[0].regularPrice?.value).toBe('49.90');
    expect(shirt.variants[0].salePrice?.value).toBe('39.90');
    expect(shirt.variants[0].weightGrams).toBe(280);
    expect(shirt.variants[0].barcode?.value).toBe('4006381333931');
    // Simple Arabic product gets Default Title in Shopify
    const mug = shopifyCatalog.products[1];
    expect(mug.title?.value).toBe('كوب سيراميك يدوي');
    expect(mug.variants[0].isDefaultVariant).toBe(true);
    expect(mug.variants[0].regularPrice?.value).toBe('180.00');
  });

  it('converts Shopify -> Google Merchant Center with variants, exact /products/<handle> links, and currency', () => {
    const shopifySample = SAMPLE_FEEDS.find((s) => s.id === 'shopify')!;
    const parsed = parseString(shopifySample.content);
    const catalog = readCatalog(parsed, 'shopify');

    // Unambiguous currency detection: only "1,200 EGP" has an explicit currency -> EGP
    expect(detectUnambiguousCurrency(catalog)).toBe('EGP');

    // Report without base URL or currency warns about missing links, currency, and condition
    const reportWithout = analyzeConversion(catalog, 'google');
    expect(reportWithout.notices.some((n) => n.field === 'link' && n.kind === 'missing')).toBe(
      true,
    );
    expect(reportWithout.notices.some((n) => n.field === 'currency' && n.kind === 'missing')).toBe(
      true,
    );
    expect(reportWithout.notices.some((n) => n.field === 'condition' && n.kind === 'missing')).toBe(
      true,
    );

    const exported = exportCatalog({
      parsed,
      catalog,
      target: 'google',
      googleOptions: {
        storeBaseUrl: 'https://northwind.example.com/',
        currencyCode: 'EGP',
      },
    });

    expect(exported.delimiter).toBe('\t');
    const gParsed = parseCsvBytes(exported.bytes);
    const gCatalog = readCatalog(gParsed, 'google');
    const oxford = gCatalog.products[0];
    expect(oxford.itemGroupId?.value).toBe('cotton-oxford-shirt');
    expect(oxford.variants).toHaveLength(3);
    expect(oxford.variants[0].link?.value).toBe(
      'https://northwind.example.com/products/cotton-oxford-shirt',
    );
    expect(oxford.variants[0].regularPrice?.value).toBe('1450.00 EGP');
    expect(oxford.variants[0].salePrice?.value).toBe('1200.00 EGP');
    // Condition is NEVER invented
    expect(oxford.variants[0].condition).toBeUndefined();
  });

  it('never invents WooCommerce links when exporting to Google and omits core-unsupported barcode/brand on export to WooCommerce', () => {
    const wooSample = SAMPLE_FEEDS.find((s) => s.id === 'woocommerce')!;
    const wooCatalog = readCatalog(parseString(wooSample.content), 'woocommerce');
    const toGoogleReport = analyzeConversion(wooCatalog, 'google', {
      storeBaseUrl: 'https://mywoostore.example.com',
      currencyCode: 'USD',
    });
    expect(toGoogleReport.canDeriveGoogleLinks).toBe(false);
    expect(toGoogleReport.notices.some((n) => n.field === 'link' && n.kind === 'missing')).toBe(
      true,
    );

    const toGoogle = exportCatalog({
      parsed: parseString(wooSample.content),
      catalog: wooCatalog,
      target: 'google',
      googleOptions: { storeBaseUrl: 'https://mywoostore.example.com', currencyCode: 'USD' },
    });
    const reparsedGoogle = readCatalog(parseCsvBytes(toGoogle.bytes), 'google');
    expect(reparsedGoogle.products[0].variants[0].link).toBeUndefined();

    // Shopify -> WooCommerce omits barcodes and brands (neither existed in WooCommerce 2023 core) and reports both
    const shopifySample = SAMPLE_FEEDS.find((s) => s.id === 'shopify')!;
    const shopifyParsed = parseString(shopifySample.content);
    const shopifyCatalog = readCatalog(shopifyParsed, 'shopify');
    const toWooReport = analyzeConversion(shopifyCatalog, 'woocommerce');
    expect(toWooReport.notices.some((n) => n.field === 'barcode' && n.kind === 'lost')).toBe(true);
    expect(toWooReport.notices.some((n) => n.field === 'brand' && n.kind === 'lost')).toBe(true);

    const toWoo = exportCatalog({
      parsed: shopifyParsed,
      catalog: shopifyCatalog,
      target: 'woocommerce',
    });
    expect(toWoo.content).not.toContain('GTIN, UPC, EAN, or ISBN');
    expect(toWoo.content).not.toContain('Meta: _gtin');
  });

  it('preserves extra columns on same-format export, quotes RFC 4180 cells, supports UTF-8 BOM, and exports change log CSV', () => {
    const csv = [
      'Handle,Title,Variant Price,SEO Title,Custom Note',
      'a-1,"Shirt, ""Blue""","1,200 EGP","Best Shirt","Line 1\nLine 2"',
    ].join('\n');
    const parsed = parseString(csv);
    const catalog = readCatalog(parsed, 'shopify');
    const rules = runRules(parsed, catalog);
    const fixed = applyFixes(parsed, acceptSafeFixes(buildFixPlan(rules.problems)));

    const exported = exportCatalog({
      parsed: fixed.parsed,
      catalog,
      target: 'same',
      includeBom: true,
    });

    // UTF-8 BOM present at byte 0..2
    expect(exported.bytes[0]).toBe(0xef);
    expect(exported.bytes[1]).toBe(0xbb);
    expect(exported.bytes[2]).toBe(0xbf);

    const reparsed = parseCsvBytes(exported.bytes);
    expect(reparsed.headers).toEqual([
      'Handle',
      'Title',
      'Variant Price',
      'SEO Title',
      'Custom Note',
    ]);
    expect(reparsed.rows[0]).toEqual([
      'a-1',
      'Shirt, "Blue"',
      '1200.00',
      'Best Shirt',
      'Line 1\nLine 2',
    ]);

    const logCsv = serializeChangeLogCsv(fixed.changeLog, true);
    expect(logCsv.startsWith('\uFEFFRow,Column,Before,After,Rule,Rule ID')).toBe(true);
    expect(logCsv).toContain('"1,200 EGP",1200.00');

    // RFC 4180 standalone check
    expect(serializeCsv(['A', 'B'], [['x,y', 'a"b']])).toBe('A,B\r\n"x,y","a""b"\r\n');
  });
});
