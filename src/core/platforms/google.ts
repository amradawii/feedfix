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
