import { detectPlatform } from '../detect';
import { CatalogModel, Platform, Product, readCell, Variant } from '../model';
import { ParsedCsv } from '../parse';
import { readGoogleCatalog } from './google';
import { readShopifyCatalog } from './shopify';
import { readWooCommerceCatalog } from './woocommerce';

export type FieldMapping = Partial<
  Record<
    | 'id'
    | 'handle'
    | 'title'
    | 'description'
    | 'vendor'
    | 'sku'
    | 'regularPrice'
    | 'salePrice'
    | 'barcode'
    | 'inventoryQty'
    | 'availability'
    | 'condition'
    | 'category'
    | 'tags'
    | 'image'
    | 'link'
    | 'status'
    | 'weight',
    number
  >
>;

export function readOtherCatalog(parsed: ParsedCsv, mapping: FieldMapping = {}): CatalogModel {
  const { headers, rows } = parsed;
  const products: Product[] = [];
  const columnMap: Record<string, number> = {};
  const mappedIndices = new Set<number>();

  for (const [k, v] of Object.entries(mapping)) {
    if (v !== undefined && v >= 0 && v < headers.length) {
      columnMap[k] = v;
      mappedIndices.add(v);
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;
    if (row.every((c) => c.trim() === '')) continue;

    const imageCell = readCell(row, headers, rowNumber, columnMap.image);
    const variant: Variant = {
      sourceRow: rowNumber,
      id: readCell(row, headers, rowNumber, columnMap.id),
      sku: readCell(row, headers, rowNumber, columnMap.sku),
      regularPrice: readCell(row, headers, rowNumber, columnMap.regularPrice),
      salePrice: readCell(row, headers, rowNumber, columnMap.salePrice),
      barcode: readCell(row, headers, rowNumber, columnMap.barcode),
      inventoryQty: readCell(row, headers, rowNumber, columnMap.inventoryQty),
      availability: readCell(row, headers, rowNumber, columnMap.availability),
      condition: readCell(row, headers, rowNumber, columnMap.condition),
      weight: readCell(row, headers, rowNumber, columnMap.weight),
      optionValues: [],
      image: imageCell,
      link: readCell(row, headers, rowNumber, columnMap.link),
    };

    const tagsCell = readCell(row, headers, rowNumber, columnMap.tags);
    const product: Product = {
      sourceRow: rowNumber,
      sourceRows: [rowNumber],
      id: variant.id,
      handle: readCell(row, headers, rowNumber, columnMap.handle),
      title: readCell(row, headers, rowNumber, columnMap.title),
      descriptionHtml: readCell(row, headers, rowNumber, columnMap.description),
      vendor: readCell(row, headers, rowNumber, columnMap.vendor),
      productCategory: readCell(row, headers, rowNumber, columnMap.category),
      tags: tagsCell
        ? tagsCell.value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
            .map((value) => ({ value, ref: tagsCell.ref }))
        : [],
      categories: [],
      status: readCell(row, headers, rowNumber, columnMap.status),
      link: variant.link,
      images: imageCell ? [{ url: imageCell }] : [],
      options: [],
      variants: [variant],
    };

    products.push(product);
  }

  const extraColumns = headers.filter((_, idx) => !mappedIndices.has(idx));

  return {
    platform: 'other',
    headers,
    rowCount: rows.length,
    products,
    structuralIssues: [],
    columnMap,
    extraColumns,
  };
}

export function readCatalog(
  parsed: ParsedCsv,
  platformOverride?: Platform,
  otherMapping?: FieldMapping,
): CatalogModel {
  const platform = platformOverride ?? detectPlatform(parsed.headers).platform;
  switch (platform) {
    case 'shopify':
      return readShopifyCatalog(parsed);
    case 'woocommerce':
      return readWooCommerceCatalog(parsed);
    case 'google':
      return readGoogleCatalog(parsed);
    case 'other':
      return readOtherCatalog(parsed, otherMapping);
  }
}

export { readShopifyCatalog, writeShopifyCatalog, SHOPIFY_EXPORT_HEADERS } from './shopify';
export { readWooCommerceCatalog, writeWooCommerceCatalog } from './woocommerce';
export {
  readGoogleCatalog,
  writeGoogleCatalog,
  GOOGLE_EXPORT_HEADERS,
  type GoogleExportOptions,
} from './google';
