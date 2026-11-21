import {
  CatalogModel,
  normalizeHeader,
  parseWeightToGrams,
  Product,
  ProductImage,
  ProductOption,
  readCell,
  StructuralIssue,
  TrackedString,
  Variant,
} from '../model';
import { ParsedCsv } from '../parse';
import { parsePriceValue } from '../rules/price';

export const GOOGLE_COLUMN_ALIASES: Record<string, string[]> = {
  id: ['id'],
  itemGroupId: ['item_group_id', 'item group id'],
  title: ['title'],
  description: ['description'],
  link: ['link'],
  imageLink: ['image_link', 'image link'],
  additionalImageLink: ['additional_image_link', 'additional image link'],
  availability: ['availability'],
  availabilityDate: ['availability_date', 'availability date'],
  price: ['price'],
  salePrice: ['sale_price', 'sale price'],
  brand: ['brand'],
  gtin: ['gtin'],
  mpn: ['mpn'],
  identifierExists: ['identifier_exists', 'identifier exists'],
  condition: ['condition'],
  googleProductCategory: ['google_product_category', 'google product category'],
  productType: ['product_type', 'product type'],
  shippingWeight: ['shipping_weight', 'shipping weight'],
  color: ['color'],
  size: ['size'],
  material: ['material'],
  pattern: ['pattern'],
  gender: ['gender'],
  ageGroup: ['age_group', 'age group'],
};

const VARIANT_ATTR_KEYS = [
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'material', label: 'Material' },
  { key: 'pattern', label: 'Pattern' },
] as const;

function resolveColumns(headers: string[]): {
  columnMap: Record<string, number>;
  extraColumns: string[];
} {
  const normHeaders = headers.map(normalizeHeader);
  const columnMap: Record<string, number> = {};
  const mappedIndices = new Set<number>();

  for (const [key, aliases] of Object.entries(GOOGLE_COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = normHeaders.indexOf(alias);
      if (idx !== -1) {
        columnMap[key] = idx;
        mappedIndices.add(idx);
        break;
      }
    }
  }

  const extraColumns: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (!mappedIndices.has(i)) {
      extraColumns.push(headers[i]);
    }
  }

  return { columnMap, extraColumns };
}

function splitAdditionalImages(tracked: TrackedString | undefined): ProductImage[] {
  if (!tracked) return [];
  return tracked.value
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
    .map((value) => ({ url: { value, ref: tracked.ref } }));
}

export function readGoogleCatalog(parsed: ParsedCsv): CatalogModel {
  const { headers, rows } = parsed;
  const { columnMap, extraColumns } = resolveColumns(headers);
  const products: Product[] = [];
  const structuralIssues: StructuralIssue[] = [];
  const productsByGroup = new Map<string, Product>();

  // Track ungrouped rows with identical titles + variant attributes (missing item_group_id check)
  const ungroupedByTitle = new Map<string, Array<{ row: number; hasVariantAttr: boolean }>>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    if (row.every((c) => c.trim() === '')) {
      continue;
    }

    const idCell = readCell(row, headers, rowNumber, columnMap.id);
    const groupCell = readCell(row, headers, rowNumber, columnMap.itemGroupId);
    const titleCell = readCell(row, headers, rowNumber, columnMap.title);
    const descCell = readCell(row, headers, rowNumber, columnMap.description);
    const linkCell = readCell(row, headers, rowNumber, columnMap.link);
    const imageCell = readCell(row, headers, rowNumber, columnMap.imageLink);
    const extraImages = splitAdditionalImages(
      readCell(row, headers, rowNumber, columnMap.additionalImageLink),
    );
    const weightCell = readCell(row, headers, rowNumber, columnMap.shippingWeight);

    const optionValues: Array<{ name: string; value: TrackedString }> = [];
    for (const attr of VARIANT_ATTR_KEYS) {
      const val = readCell(row, headers, rowNumber, columnMap[attr.key]);
      if (val) {
        optionValues.push({ name: attr.label, value: val });
      }
    }

    const variant: Variant = {
      sourceRow: rowNumber,
      id: idCell,
      sku: idCell,
      regularPrice: readCell(row, headers, rowNumber, columnMap.price),
      salePrice: readCell(row, headers, rowNumber, columnMap.salePrice),
      barcode: readCell(row, headers, rowNumber, columnMap.gtin),
      mpn: readCell(row, headers, rowNumber, columnMap.mpn),
      identifierExists: readCell(row, headers, rowNumber, columnMap.identifierExists),
      availability: readCell(row, headers, rowNumber, columnMap.availability),
      availabilityDate: readCell(row, headers, rowNumber, columnMap.availabilityDate),
      condition: readCell(row, headers, rowNumber, columnMap.condition),
      weight: weightCell,
      weightGrams: weightCell ? parseWeightToGrams(weightCell.value) : undefined,
      optionValues,
      image: imageCell,
      link: linkCell,
    };

    const rowImages: ProductImage[] = [];
    if (imageCell) {
      rowImages.push({ url: imageCell });
    }
    rowImages.push(...extraImages);

    if (groupCell) {
      const existing = productsByGroup.get(groupCell.value);
      if (existing) {
        existing.sourceRows.push(rowNumber);
        existing.variants.push(variant);
        for (const opt of optionValues) {
          let existingOpt = existing.options.find((o) => o.name === opt.name);
          if (!existingOpt) {
            existingOpt = { name: opt.name, values: [] };
            existing.options.push(existingOpt);
          }
          if (!existingOpt.values.includes(opt.value.value)) {
            existingOpt.values.push(opt.value.value);
          }
        }
        for (const img of rowImages) {
          if (!existing.images.some((e) => e.url.value === img.url.value)) {
            existing.images.push(img);
          }
        }
        continue;
      }
    } else if (titleCell) {
      const normTitle = titleCell.value.toLowerCase();
      const bucket = ungroupedByTitle.get(normTitle) ?? [];
      bucket.push({ row: rowNumber, hasVariantAttr: optionValues.length > 0 });
      ungroupedByTitle.set(normTitle, bucket);
    }

    const options: ProductOption[] = optionValues.map((o) => ({
      name: o.name,
      values: [o.value.value],
    }));

    const product: Product = {
      sourceRow: rowNumber,
      sourceRows: [rowNumber],
      id: idCell,
      itemGroupId: groupCell,
      title: titleCell,
      descriptionHtml: descCell,
      vendor: readCell(row, headers, rowNumber, columnMap.brand),
      productCategory: readCell(row, headers, rowNumber, columnMap.googleProductCategory),
      productType: readCell(row, headers, rowNumber, columnMap.productType),
      tags: [],
      categories: [],
      link: linkCell,
      images: rowImages,
      options,
      variants: [variant],
    };

    products.push(product);
    if (groupCell) {
      productsByGroup.set(groupCell.value, product);
    }
  }

  for (const [title, entries] of ungroupedByTitle.entries()) {
    if (entries.length > 1 && entries.some((e) => e.hasVariantAttr)) {
      for (const entry of entries) {
        structuralIssues.push({
          kind: 'google_missing_item_group_id',
          row: entry.row,
          col: columnMap.itemGroupId,
          columnName: headers[columnMap.itemGroupId ?? 0] ?? 'item_group_id',
          detail: `Variant rows sharing title "${title}" are missing item_group_id.`,
          rawValue: title,
        });
      }
    }
  }

  return {
    platform: 'google',
    headers,
    rowCount: rows.length,
    products,
    structuralIssues,
    columnMap,
    extraColumns,
  };
}

export interface GoogleExportOptions {
  /** Optional store base URL used ONLY where links can be derived exactly (e.g. Shopify /products/<handle>) */
  storeBaseUrl?: string;
  /** Optional 3-letter ISO-4217 currency code (e.g. USD, EGP, EUR) */
  currencyCode?: string;
}

export const GOOGLE_EXPORT_HEADERS = [
  'id',
  'item_group_id',
  'title',
  'description',
  'link',
  'image_link',
  'additional_image_link',
  'availability',
  'availability_date',
  'price',
  'sale_price',
  'brand',
  'gtin',
  'mpn',
  'identifier_exists',
  'condition',
  'google_product_category',
  'product_type',
  'color',
  'size',
  'material',
  'pattern',
  'shipping_weight',
] as const;

function stripHtmlForGoogle(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatGooglePrice(raw: string | undefined, fallbackCurrency?: string): string {
  if (!raw) return '';
  const parsed = parsePriceValue(raw);
  if (!parsed.ok) return raw.trim();
  const currency = parsed.isoCurrency ?? fallbackCurrency?.trim().toUpperCase();
  return currency ? `${parsed.normalizedNumber} ${currency}` : parsed.normalizedNumber;
}

function mapAvailabilityToGoogle(variant: Variant): string {
  const raw = variant.availability?.value.trim().toLowerCase();
  if (raw) {
    if (raw === 'in_stock' || raw === 'in stock' || raw === '1' || raw === 'true') {
      return 'in_stock';
    }
    if (raw === 'out_of_stock' || raw === 'out of stock' || raw === '0' || raw === 'false') {
      return 'out_of_stock';
    }
    if (raw === 'preorder' || raw === 'pre-order' || raw === 'pre order') {
      return 'preorder';
    }
    if (raw === 'backorder' || raw === 'on backorder' || raw === 'back-order') {
      return 'backorder';
    }
  }

  if (variant.inventoryQty?.value) {
    const qty = Number(variant.inventoryQty.value);
    if (Number.isFinite(qty)) {
      if (qty > 0) return 'in_stock';
      if (variant.inventoryPolicy?.value.toLowerCase() === 'continue') return 'backorder';
      return 'out_of_stock';
    }
  }

  return '';
}

function deriveGoogleLink(
  catalogPlatform: CatalogModel['platform'],
  product: Product,
  variant: Variant,
  storeBaseUrl?: string,
): string {
  if (variant.link?.value) return variant.link.value;
  if (product.link?.value) return product.link.value;

  // Derive link ONLY where the platform URL pattern is exact (Shopify: base + /products/ + handle).
  // Never invent links for WooCommerce or other CSVs.
  if (catalogPlatform === 'shopify' && storeBaseUrl?.trim() && product.handle?.value) {
    const base = storeBaseUrl.trim().replace(/\/+$/, '');
    return `${base}/products/${encodeURIComponent(product.handle.value)}`;
  }

  return '';
}

function findVariantAttr(variant: Variant, names: string[]): string {
  for (const ov of variant.optionValues) {
    if (names.includes(ov.name.trim().toLowerCase())) {
      return ov.value.value;
    }
  }
  return '';
}

export function writeGoogleCatalog(
  catalog: CatalogModel,
  options: GoogleExportOptions = {},
): { headers: string[]; rows: string[][] } {
  const headers = [...GOOGLE_EXPORT_HEADERS];
  const rows: string[][] = [];
  const currency = options.currencyCode?.trim().toUpperCase() || undefined;

  for (let pIdx = 0; pIdx < catalog.products.length; pIdx++) {
    const product = catalog.products[pIdx];
    const variants: Variant[] =
      product.variants.length > 0
        ? product.variants
        : [{ sourceRow: product.sourceRow, optionValues: [] }];

    const isMultiVariant = variants.length > 1;
    const groupId =
      product.itemGroupId?.value ??
      (isMultiVariant ? (product.handle?.value ?? product.id?.value ?? `group-${pIdx + 1}`) : '');

    const description = stripHtmlForGoogle(
      product.descriptionHtml?.value ?? product.shortDescription?.value,
    );

    const productImages = product.images.map((i) => i.url.value);
    const productType =
      product.productType?.value ??
      (product.categories.length > 0 ? product.categories[0].value : '');

    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const variant = variants[vIdx];
      const itemId =
        variant.id?.value ??
        variant.sku?.value ??
        (isMultiVariant && product.handle?.value
          ? `${product.handle.value}-${vIdx + 1}`
          : (product.handle?.value ?? ''));

      const primaryImage = variant.image?.value ?? productImages[0] ?? '';
      const additionalImages = productImages.filter((u) => u !== primaryImage).join(', ');

      const link = deriveGoogleLink(catalog.platform, product, variant, options.storeBaseUrl);
      const weight =
        variant.weightGrams !== undefined && variant.weightGrams !== null
          ? `${variant.weightGrams} g`
          : (variant.weight?.value ?? '');

      rows.push([
        itemId,
        groupId,
        product.title?.value ?? '',
        description,
        link,
        primaryImage,
        additionalImages,
        mapAvailabilityToGoogle(variant),
        variant.availabilityDate?.value ?? '',
        formatGooglePrice(variant.regularPrice?.value, currency),
        formatGooglePrice(variant.salePrice?.value, currency),
        product.vendor?.value ?? '',
        variant.barcode?.value ?? '',
        variant.mpn?.value ?? '',
        variant.identifierExists?.value ?? '',
        variant.condition?.value ?? '',
        product.productCategory?.value ?? '',
        productType,
        findVariantAttr(variant, ['color', 'colour']),
        findVariantAttr(variant, ['size']),
        findVariantAttr(variant, ['material']),
        findVariantAttr(variant, ['pattern']),
        weight,
      ]);
    }
  }

  return { headers, rows };
}
