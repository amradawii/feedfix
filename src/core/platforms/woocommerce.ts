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

export const WOOCOMMERCE_COLUMN_ALIASES: Record<string, string[]> = {
  id: ['id'],
  type: ['type'],
  sku: ['sku'],
  name: ['name'],
  published: ['published'],
  shortDescription: ['short description'],
  description: ['description'],
  inStock: ['in stock?'],
  stock: ['stock'],
  salePrice: ['sale price'],
  regularPrice: ['regular price'],
  categories: ['categories'],
  tags: ['tags'],
  images: ['images'],
  parent: ['parent'],
  // 2023 WooCommerce plugin barcode meta columns (optional read aliases; core had no GTIN column in 2023)
  pluginBarcode: ['meta: _gtin', 'meta: _wpm_gtin_code', 'meta: _ts_gtin', 'meta: _barcode'],
};

interface AttributeColumnPair {
  index: number;
  nameCol: number;
  valueCol?: number;
}

interface WeightColumnInfo {
  col: number;
  unit: 'kg' | 'g' | 'lbs' | 'oz';
}

function resolveColumns(headers: string[]): {
  columnMap: Record<string, number>;
  attributes: AttributeColumnPair[];
  weightCol?: WeightColumnInfo;
  extraColumns: string[];
} {
  const normHeaders = headers.map(normalizeHeader);
  const columnMap: Record<string, number> = {};
  const mappedIndices = new Set<number>();

  for (const [key, aliases] of Object.entries(WOOCOMMERCE_COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = normHeaders.indexOf(alias);
      if (idx !== -1) {
        columnMap[key] = idx;
        mappedIndices.add(idx);
        break;
      }
    }
  }

  let weightCol: WeightColumnInfo | undefined;
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i];
    if (h === 'weight (kg)' || h === 'weight') {
      weightCol = { col: i, unit: 'kg' };
      columnMap.weight = i;
      mappedIndices.add(i);
      break;
    }
    if (h === 'weight (g)') {
      weightCol = { col: i, unit: 'g' };
      columnMap.weight = i;
      mappedIndices.add(i);
      break;
    }
    if (h === 'weight (lbs)' || h === 'weight (lb)') {
      weightCol = { col: i, unit: 'lbs' };
      columnMap.weight = i;
      mappedIndices.add(i);
      break;
    }
    if (h === 'weight (oz)') {
      weightCol = { col: i, unit: 'oz' };
      columnMap.weight = i;
      mappedIndices.add(i);
      break;
    }
  }

  const attrMap = new Map<number, AttributeColumnPair>();
  for (let i = 0; i < normHeaders.length; i++) {
    const h = normHeaders[i];
    const nameMatch = h.match(/^attribute\s+(\d+)\s+name$/);
    if (nameMatch) {
      const idx = Number(nameMatch[1]);
      const pair = attrMap.get(idx) ?? { index: idx, nameCol: i };
      pair.nameCol = i;
      attrMap.set(idx, pair);
      mappedIndices.add(i);
      continue;
    }
    const valMatch = h.match(/^attribute\s+(\d+)\s+value\(s\)$/);
    if (valMatch) {
      const idx = Number(valMatch[1]);
      const pair = attrMap.get(idx) ?? { index: idx, nameCol: -1 };
      pair.valueCol = i;
      attrMap.set(idx, pair);
      mappedIndices.add(i);
    }
  }

  const attributes = [...attrMap.values()]
    .filter((a) => a.nameCol >= 0)
    .sort((a, b) => a.index - b.index);

  const extraColumns: string[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (!mappedIndices.has(i)) {
      extraColumns.push(headers[i]);
    }
  }

  return { columnMap, attributes, weightCol, extraColumns };
}

function splitList(tracked: TrackedString | undefined): TrackedString[] {
  if (!tracked) return [];
  return tracked.value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((value) => ({ value, ref: tracked.ref }));
}

function getPrimaryWooType(rawType: string | undefined): string {
  if (!rawType) return 'simple';
  const tokens = rawType
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  for (const primary of ['variation', 'variable', 'grouped', 'external', 'simple']) {
    if (tokens.includes(primary)) return primary;
  }
  return tokens[0] ?? 'simple';
}

export function readWooCommerceCatalog(parsed: ParsedCsv): CatalogModel {
  const { headers, rows } = parsed;
  const { columnMap, attributes, weightCol, extraColumns } = resolveColumns(headers);
  const products: Product[] = [];
  const structuralIssues: StructuralIssue[] = [];

  const parentBySku = new Map<string, Product>();
  const parentById = new Map<string, Product>();

  interface PendingVariation {
    rowNumber: number;
    parentRef?: TrackedString;
    variant: Variant;
    title?: TrackedString;
    descriptionHtml?: TrackedString;
    status?: TrackedString;
    wooType?: TrackedString;
    images: ProductImage[];
    vendor?: TrackedString;
  }

  const pendingVariations: PendingVariation[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    if (row.every((c) => c.trim() === '')) {
      continue;
    }

    const idCell = readCell(row, headers, rowNumber, columnMap.id);
    const typeCell = readCell(row, headers, rowNumber, columnMap.type);
    const skuCell = readCell(row, headers, rowNumber, columnMap.sku);
    const nameCell = readCell(row, headers, rowNumber, columnMap.name);
    const publishedCell = readCell(row, headers, rowNumber, columnMap.published);
    const shortDescCell = readCell(row, headers, rowNumber, columnMap.shortDescription);
    const descCell = readCell(row, headers, rowNumber, columnMap.description);
    const inStockCell = readCell(row, headers, rowNumber, columnMap.inStock);
    const stockCell = readCell(row, headers, rowNumber, columnMap.stock);
    const regularPriceCell = readCell(row, headers, rowNumber, columnMap.regularPrice);
    const salePriceCell = readCell(row, headers, rowNumber, columnMap.salePrice);
    const barcodeCell = readCell(row, headers, rowNumber, columnMap.pluginBarcode);
    const weightCell = readCell(row, headers, rowNumber, weightCol?.col);
    const imagesList = splitList(readCell(row, headers, rowNumber, columnMap.images)).map(
      (url, idx): ProductImage => ({
        url,
        position: { value: String(idx + 1), ref: url.ref },
      }),
    );

    const options: ProductOption[] = [];
    const optionValues: Array<{ name: string; value: TrackedString }> = [];
    let brandAttr: TrackedString | undefined;

    for (const attr of attributes) {
      const attrName = readCell(row, headers, rowNumber, attr.nameCol);
      const attrVal = readCell(row, headers, rowNumber, attr.valueCol);
      if (!attrName) continue;

      if (attrName.value.toLowerCase() === 'brand' && attrVal && !brandAttr) {
        brandAttr = attrVal;
        continue;
      }

      if (attrVal) {
        const values = attrVal.value
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
        options.push({ name: attrName.value, nameRef: attrName.ref, values });
        optionValues.push({ name: attrName.value, value: attrVal });
      }
    }

    const primaryType = getPrimaryWooType(typeCell?.value);

    const variant: Variant = {
      sourceRow: rowNumber,
      id: idCell,
      sku: skuCell,
      regularPrice: regularPriceCell,
      salePrice: salePriceCell,
      barcode: barcodeCell,
      inventoryQty: stockCell,
      availability: inStockCell,
      weight: weightCell,
      weightGrams: weightCell ? parseWeightToGrams(weightCell.value, weightCol?.unit) : undefined,
      weightUnit: weightCol?.unit,
      optionValues,
      image: imagesList[0]?.url,
    };

    if (primaryType === 'variation') {
      pendingVariations.push({
        rowNumber,
        parentRef: readCell(row, headers, rowNumber, columnMap.parent),
        variant,
        title: nameCell,
        descriptionHtml: descCell,
        status: publishedCell,
        wooType: typeCell,
        images: imagesList,
        vendor: brandAttr,
      });
      continue;
    }

    const product: Product = {
      sourceRow: rowNumber,
      sourceRows: [rowNumber],
      id: idCell,
      title: nameCell,
      descriptionHtml: descCell,
      shortDescription: shortDescCell,
      vendor: brandAttr,
      wooType: typeCell,
      productType: typeCell,
      tags: splitList(readCell(row, headers, rowNumber, columnMap.tags)),
      categories: splitList(readCell(row, headers, rowNumber, columnMap.categories)),
      status: publishedCell,
      images: imagesList,
      options,
      variants: primaryType === 'variable' ? [] : [variant],
    };

    products.push(product);

    if (skuCell) {
      parentBySku.set(skuCell.value, product);
    }
    if (idCell) {
      parentById.set(idCell.value, product);
    }
  }

  // Attach variations to their parent products (supports SKU or id:<ID> references)
  for (const pending of pendingVariations) {
    let parent: Product | undefined;
    const rawParent = pending.parentRef?.value;

    if (rawParent) {
      const idMatch = rawParent.match(/^id:(.+)$/i);
      if (idMatch) {
        parent = parentById.get(idMatch[1].trim());
      } else {
        parent = parentBySku.get(rawParent) ?? parentById.get(rawParent);
      }
    }

    if (!parent) {
      structuralIssues.push({
        kind: 'woo_orphan_variation',
        row: pending.rowNumber,
        col: pending.parentRef?.ref.col ?? columnMap.parent,
        columnName: pending.parentRef?.ref.columnName ?? headers[columnMap.parent ?? 0] ?? 'Parent',
        detail: rawParent
          ? `Variation points to missing parent "${rawParent}".`
          : 'Variation row has no Parent value.',
        rawValue: rawParent,
      });

      // Keep orphan variation as a standalone product so price/SKU/barcode rules still check it.
      products.push({
        sourceRow: pending.rowNumber,
        sourceRows: [pending.rowNumber],
        id: pending.variant.id,
        title: pending.title,
        descriptionHtml: pending.descriptionHtml,
        vendor: pending.vendor,
        wooType: pending.wooType,
        productType: pending.wooType,
        tags: [],
        categories: [],
        status: pending.status,
        images: pending.images,
        options: [],
        variants: [pending.variant],
      });
      continue;
    }

    if (getPrimaryWooType(parent.wooType?.value) !== 'variable') {
      structuralIssues.push({
        kind: 'woo_variation_parent_not_variable',
        row: pending.rowNumber,
        col: pending.parentRef?.ref.col,
        columnName: pending.parentRef?.ref.columnName ?? 'Parent',
        detail: `Variation parent "${rawParent}" has Type "${
          parent.wooType?.value ?? 'simple'
        }" instead of "variable".`,
        rawValue: rawParent,
      });
    }

    parent.sourceRows.push(pending.rowNumber);
    parent.variants.push(pending.variant);
    if (!parent.vendor && pending.vendor) {
      parent.vendor = pending.vendor;
    }
  }

  return {
    platform: 'woocommerce',
    headers,
    rowCount: rows.length,
    products,
    structuralIssues,
    columnMap,
    extraColumns,
  };
}

const WOO_BASE_EXPORT_HEADERS = [
  'ID',
  'Type',
  'SKU',
  'Name',
  'Published',
  'Is featured?',
  'Visibility in catalog',
  'Short description',
  'Description',
  'In stock?',
  'Stock',
  'Weight (kg)',
  'Sale price',
  'Regular price',
  'Categories',
  'Tags',
  'Images',
  'Parent',
] as const;

function formatCleanWooPrice(raw: string | undefined): string {
  if (!raw) return '';
  const parsed = parsePriceValue(raw);
  return parsed.ok ? parsed.normalizedNumber : raw.trim();
}

function formatGramsAsKg(grams: number | null | undefined): string {
  if (grams === undefined || grams === null) return '';
  // Integer-based conversion to avoid floating-point artifacts
  const whole = Math.floor(grams / 1000);
  const rem = grams % 1000;
  if (rem === 0) return String(whole);
  const frac = String(rem).padStart(3, '0').replace(/0+$/, '');
  return `${whole}.${frac}`;
}

function mapStatusToWooPublished(rawStatus: string | undefined): string {
  if (!rawStatus) return '1';
  const lower = rawStatus.trim().toLowerCase();
  if (lower === '1' || lower === 'active' || lower === 'true' || lower === 'published') return '1';
  if (lower === '0' || lower === 'private') return '0';
  if (lower === '2' || lower === 'pending') return '2';
  if (lower === '-1' || lower === 'draft' || lower === 'archived' || lower === 'false') return '-1';
  return '1';
}

function mapAvailabilityToWooInStock(variant: Variant): string {
  const avail = variant.availability?.value.trim().toLowerCase();
  if (avail) {
    if (avail === '1' || avail === 'in_stock' || avail === 'in stock' || avail === 'true') {
      return '1';
    }
    if (
      avail === '0' ||
      avail === 'out_of_stock' ||
      avail === 'out of stock' ||
      avail === 'false'
    ) {
      return '0';
    }
    if (avail === 'backorder' || avail === 'on backorder') {
      return 'backorder';
    }
  }
  if (variant.inventoryQty?.value) {
    const qty = Number(variant.inventoryQty.value);
    if (Number.isFinite(qty)) {
      if (qty > 0) return '1';
      if (variant.inventoryPolicy?.value.toLowerCase() === 'continue') return 'backorder';
      return '0';
    }
  }
  return '';
}

/**
 * Writes products in late-2023 WooCommerce 8.2/8.3 built-in CSV importer format.
 * Intentionally omits GTIN/barcode and Brand columns (neither existed in WooCommerce core in 2023).
 */
export function writeWooCommerceCatalog(catalog: CatalogModel): {
  headers: string[];
  rows: string[][];
} {
  let maxAttrs = 0;
  for (const product of catalog.products) {
    const nonDefaultOptions = product.options.filter(
      (o) =>
        !(
          o.name.toLowerCase() === 'title' &&
          o.values.length === 1 &&
          o.values[0].toLowerCase() === 'default title'
        ),
    );
    if (nonDefaultOptions.length > maxAttrs) {
      maxAttrs = nonDefaultOptions.length;
    }
  }

  const headers: string[] = [...WOO_BASE_EXPORT_HEADERS];
  for (let a = 1; a <= maxAttrs; a++) {
    headers.push(
      `Attribute ${a} name`,
      `Attribute ${a} value(s)`,
      `Attribute ${a} visible`,
      `Attribute ${a} global`,
    );
  }

  const rows: string[][] = [];

  for (let pIdx = 0; pIdx < catalog.products.length; pIdx++) {
    const product = catalog.products[pIdx];
    const published = mapStatusToWooPublished(product.status?.value);
    const categories =
      product.categories.length > 0
        ? product.categories.map((c) => c.value).join(', ')
        : product.productCategory?.value ?? product.productType?.value ?? '';
    const tags = product.tags.map((t) => t.value).join(', ');
    const images = product.images.map((img) => img.url.value).join(', ');

    const nonDefaultOptions = product.options.filter(
      (o) =>
        !(
          o.name.toLowerCase() === 'title' &&
          o.values.length === 1 &&
          o.values[0].toLowerCase() === 'default title'
        ),
    );

    const isVariable =
      product.variants.length > 1 ||
      (product.wooType?.value.toLowerCase().includes('variable') ?? false);

    if (!isVariable) {
      const v = product.variants[0];
      const baseRow = [
        product.id?.value ?? '',
        product.wooType?.value ?? 'simple',
        v?.sku?.value ?? '',
        product.title?.value ?? '',
        published,
        '0',
        'visible',
        product.shortDescription?.value ?? '',
        product.descriptionHtml?.value ?? '',
        v ? mapAvailabilityToWooInStock(v) : '',
        v?.inventoryQty?.value ?? '',
        formatGramsAsKg(v?.weightGrams),
        formatCleanWooPrice(v?.salePrice?.value),
        formatCleanWooPrice(v?.regularPrice?.value),
        categories,
        tags,
        images || (v?.image?.value ?? ''),
        '',
      ];
      for (let a = 0; a < maxAttrs; a++) {
        const opt = nonDefaultOptions[a];
        if (opt) {
          baseRow.push(opt.name, opt.values.join(', '), '1', '1');
        } else {
          baseRow.push('', '', '', '');
        }
      }
      rows.push(baseRow);
      continue;
    }

    const parentSku =
      product.handle?.value || product.itemGroupId?.value || product.id?.value || `VAR-${pIdx + 1}`;

    const parentRow = [
      product.id?.value ?? '',
      'variable',
      parentSku,
      product.title?.value ?? '',
      published,
      '0',
      'visible',
      product.shortDescription?.value ?? '',
      product.descriptionHtml?.value ?? '',
      '1',
      '',
      formatGramsAsKg(product.variants[0]?.weightGrams),
      '',
      '',
      categories,
      tags,
      images,
      '',
    ];

    for (let a = 0; a < maxAttrs; a++) {
      const opt = nonDefaultOptions[a];
      if (opt) {
        parentRow.push(opt.name, opt.values.join(', '), '1', '1');
      } else {
        parentRow.push('', '', '', '');
      }
    }
    rows.push(parentRow);

    for (const variant of product.variants) {
      const suffix = variant.optionValues.map((ov) => ov.value.value).join(' - ');
      const varName =
        product.title?.value && suffix
          ? `${product.title.value} - ${suffix}`
          : product.title?.value ?? '';

      const varRow = [
        variant.id?.value ?? '',
        'variation',
        variant.sku?.value ?? '',
        varName,
        published,
        '0',
        'visible',
        '',
        '',
        mapAvailabilityToWooInStock(variant),
        variant.inventoryQty?.value ?? '',
        formatGramsAsKg(variant.weightGrams),
        formatCleanWooPrice(variant.salePrice?.value),
        formatCleanWooPrice(variant.regularPrice?.value),
        '',
        '',
        variant.image?.value ?? '',
        parentSku,
      ];

      for (let a = 0; a < maxAttrs; a++) {
        const opt = nonDefaultOptions[a];
        if (opt) {
          const ov = variant.optionValues.find(
            (item) => item.name.toLowerCase() === opt.name.toLowerCase(),
          );
          varRow.push(opt.name, ov?.value.value ?? '', '', '1');
        } else {
          varRow.push('', '', '', '');
        }
      }
      rows.push(varRow);
    }
  }

  return { headers, rows };
}
