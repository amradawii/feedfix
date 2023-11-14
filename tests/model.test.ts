import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../src/core/detect';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { SAMPLE_FEEDS } from '../src/samples';

function parseSample(id: 'shopify' | 'woocommerce' | 'google') {
  const sample = SAMPLE_FEEDS.find((s) => s.id === id);
  if (!sample) throw new Error(`Missing sample: ${id}`);
  const bytes = new TextEncoder().encode(sample.content);
  return parseCsvBytes(bytes);
}

describe('unified product model readers', () => {
  it('maps the Shopify sample into products, variants, images, and regular/sale prices', () => {
    const parsed = parseSample('shopify');
    expect(detectPlatform(parsed.headers).platform).toBe('shopify');

    const catalog = readCatalog(parsed);
    expect(catalog.platform).toBe('shopify');
    expect(catalog.products).toHaveLength(5);

    const oxford = catalog.products[0];
    expect(oxford.handle?.value).toBe('cotton-oxford-shirt');
    expect(oxford.title?.value).toBe('Cotton Oxford Shirt');
    expect(oxford.vendor?.value).toBe('Northwind Loom');
    expect(oxford.productCategory?.value).toBe('Apparel & Accessories > Clothing > Shirts & Tops');
    // 3 variant rows + 1 extra image row => 3 variants, 2 product images
    expect(oxford.variants).toHaveLength(3);
    expect(oxford.images).toHaveLength(2);
    expect(oxford.images[1].url.value).toBe('https://example.com/images/oxford-detail.jpg');

    // Variant 1 is on sale: Compare At Price -> regularPrice, Variant Price -> salePrice
    expect(oxford.variants[0].regularPrice?.value).toBe('1450.00');
    expect(oxford.variants[0].regularPrice?.ref.columnName).toBe('Variant Compare At Price');
    expect(oxford.variants[0].salePrice?.value).toBe('1,200 EGP');
    expect(oxford.variants[0].salePrice?.ref.columnName).toBe('Variant Price');
    expect(oxford.variants[0].salePrice?.ref.row).toBe(2);

    // Non-sale product maps Variant Price -> regularPrice and leaves salePrice undefined
    const kaftan = catalog.products[1];
    expect(kaftan.variants).toHaveLength(1);
    expect(kaftan.variants[0].regularPrice?.value).toBe('٨٥٠');
    expect(kaftan.variants[0].salePrice).toBeUndefined();
    expect(kaftan.variants[0].barcode?.value).toBe('6.29E+12');
    expect(kaftan.variants[0].isDefaultVariant).toBe(true);
  });

  it('maps the WooCommerce sample including variable parent/variations, Brand attribute, and plugin GTIN alias', () => {
    const parsed = parseSample('woocommerce');
    expect(parsed.delimiter).toBe(';');
    expect(detectPlatform(parsed.headers).platform).toBe('woocommerce');

    const catalog = readCatalog(parsed);
    expect(catalog.platform).toBe('woocommerce');
    // 4 real products + 1 orphan variation kept standalone for rule inspection
    expect(catalog.products).toHaveLength(5);

    const variableShirt = catalog.products[0];
    expect(variableShirt.title?.value).toBe('Linen Summer Shirt');
    expect(variableShirt.vendor?.value).toBe('Nile Craft');
    expect(variableShirt.variants).toHaveLength(2);
    expect(variableShirt.variants[0].sku?.value).toBe('WC-SHIRT-M');
    expect(variableShirt.variants[0].regularPrice?.value).toBe('49,90');
    expect(variableShirt.variants[0].salePrice?.value).toBe('39,90');
    expect(variableShirt.variants[0].barcode?.value).toBe('4006381333931');
    expect(variableShirt.variants[0].weightGrams).toBe(280);

    // Orphan variation is flagged structurally
    expect(catalog.structuralIssues.some((iss) => iss.kind === 'woo_orphan_variation')).toBe(true);
  });

  it('maps the Google Merchant Center sample and groups variants by item_group_id', () => {
    const parsed = parseSample('google');
    expect(parsed.delimiter).toBe('\t');
    expect(detectPlatform(parsed.headers).platform).toBe('google');

    const catalog = readCatalog(parsed);
    expect(catalog.platform).toBe('google');
    // 6 rows: 2 grouped under GRP-TEE-01 + 4 standalone items = 5 products
    expect(catalog.products).toHaveLength(5);

    const tee = catalog.products[0];
    expect(tee.itemGroupId?.value).toBe('GRP-TEE-01');
    expect(tee.variants).toHaveLength(2);
    expect(tee.variants[0].id?.value).toBe('GMC-101');
    expect(tee.variants[1].salePrice?.value).toBe('24.99 USD');
    expect(tee.variants[1].barcode?.value).toBe('36000291452');
    expect(tee.variants[0].weightGrams).toBe(220);
  });

  it('supports Shopify Standardized Product Type alias and 2023 100-variant limit', () => {
    const header =
      'Handle,Title,Standardized Product Type,Option1 Name,Option1 Value,Variant Price';
    const dataRows = Array.from(
      { length: 101 },
      (_, idx) =>
        `bulk-item,${idx === 0 ? 'Bulk Shirt' : ''},${idx === 0 ? 'Apparel' : ''},${
          idx === 0 ? 'Size' : ''
        },S-${idx + 1},19.99`,
    );
    const parsed = parseCsvBytes(new TextEncoder().encode([header, ...dataRows].join('\n')));
    const catalog = readCatalog(parsed);
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].productCategory?.value).toBe('Apparel');
    expect(catalog.structuralIssues.some((iss) => iss.kind === 'shopify_too_many_variants')).toBe(
      true,
    );
  });

  it('supports WooCommerce Parent linked via id:<ID> and Weight (lbs)', () => {
    const csv = [
      'ID,Type,SKU,Name,Published,In stock?,Regular price,Weight (lbs),Parent,Attribute 1 name,Attribute 1 value(s)',
      '500,variable,VAR-P,Wool Sweater,1,1,,1.5,,Size,"S, M"',
      '501,variation,VAR-S,Wool Sweater - S,1,1,65.00,1.5,id:500,Size,S',
    ].join('\n');
    const parsed = parseCsvBytes(new TextEncoder().encode(csv));
    const catalog = readCatalog(parsed);
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0].variants).toHaveLength(1);
    expect(catalog.products[0].variants[0].weightGrams).toBe(680);
    expect(catalog.structuralIssues).toHaveLength(0);
  });
});
