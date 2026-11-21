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

export const SHOPIFY_MAX_OPTIONS_2023 = 3;
export const SHOPIFY_MAX_VARIANTS_2023 = 100;

export const SHOPIFY_COLUMN_ALIASES: Record<string, string[]> = {
  handle: ['handle'],
  title: ['title'],
  bodyHtml: ['body (html)'],
  vendor: ['vendor'],
  productCategory: ['product category', 'standardized product type'],
  type: ['type', 'custom product type', 'product type'],
  tags: ['tags'],
  published: ['published'],
  option1Name: ['option1 name'],
  option1Value: ['option1 value'],
  option2Name: ['option2 name'],
  option2Value: ['option2 value'],
  option3Name: ['option3 name'],
  option3Value: ['option3 value'],
  variantSku: ['variant sku'],
  variantGrams: ['variant grams'],
  variantInventoryTracker: ['variant inventory tracker'],
  variantInventoryQty: ['variant inventory qty'],
  variantInventoryPolicy: ['variant inventory policy'],
  variantFulfillmentService: ['variant fulfillment service'],
  variantPrice: ['variant price'],
  variantCompareAtPrice: ['variant compare at price'],
  variantBarcode: ['variant barcode'],
  imageSrc: ['image src'],
  imagePosition: ['image position'],
  imageAlt: ['image alt text'],
  variantImage: ['variant image'],
  variantWeightUnit: ['variant weight unit'],
  status: ['status'],
};

function resolveColumns(headers: string[]): {
  columnMap: Record<string, number>;
  extraColumns: string[];
  extraOptionColumns: Array<{ col: number; name: string }>;
} {
  const normHeaders = headers.map(normalizeHeader);
  const columnMap: Record<string, number> = {};
  const mappedIndices = new Set<number>();

  for (const [key, aliases] of Object.entries(SHOPIFY_COLUMN_ALIASES)) {
    for (const alias of aliases) {
      const idx = normHeaders.indexOf(alias);
      if (idx !== -1) {
        columnMap[key] = idx;
        mappedIndices.add(idx);
        break;
      }
    }
  }

  const extraOptionColumns: Array<{ col: number; name: string }> = [];
  const extraColumns: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const norm = normHeaders[i];
    if (/^option([4-9]|\d{2,})\s+name$/.test(norm)) {
      extraOptionColumns.push({ col: i, name: headers[i] });
    }
    if (!mappedIndices.has(i)) {
      extraColumns.push(headers[i]);
    }
  }

  return { columnMap, extraColumns, extraOptionColumns };
}

function splitCommaTags(tracked: TrackedString | undefined): TrackedString[] {
  if (!tracked) return [];
  return tracked.value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((value) => ({ value, ref: tracked.ref }));
}

function hasAnyVariantData(
  row: string[],
  headers: string[],
  rowNumber: number,
  colMap: Record<string, number>,
): boolean {
  const variantKeys = [
    'option1Value',
    'option2Value',
    'option3Value',
    'variantSku',
    'variantPrice',
    'variantCompareAtPrice',
    'variantBarcode',
    'variantInventoryQty',
    'variantGrams',
  ];
  return variantKeys.some((k) => readCell(row, headers, rowNumber, colMap[k]) !== undefined);
}

export function readShopifyCatalog(parsed: ParsedCsv): CatalogModel {
  const { headers, rows } = parsed;
  const { columnMap, extraColumns, extraOptionColumns } = resolveColumns(headers);
  const products: Product[] = [];
  const structuralIssues: StructuralIssue[] = [];

  const productsByHandle = new Map<string, Product>();
  const closedHandles = new Set<string>();
  let activeHandle: string | null = null;

  for (const extraOpt of extraOptionColumns) {
    structuralIssues.push({
      kind: 'shopify_too_many_options',
      row: 1,
      col: extraOpt.col,
      columnName: extraOpt.name,
      detail: `Shopify supports at most ${SHOPIFY_MAX_OPTIONS_2023} options per product (found "${extraOpt.name}").`,
      rawValue: extraOpt.name,
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    // Skip completely empty rows
    if (row.every((c) => c.trim() === '')) {
      continue;
    }

    const handleCell = readCell(row, headers, rowNumber, columnMap.handle);
    const titleCell = readCell(row, headers, rowNumber, columnMap.title);
    const imageSrcCell = readCell(row, headers, rowNumber, columnMap.imageSrc);
    const imagePosCell = readCell(row, headers, rowNumber, columnMap.imagePosition);
    const imageAltCell = readCell(row, headers, rowNumber, columnMap.imageAlt);

    if (!handleCell) {
      structuralIssues.push({
        kind: 'shopify_orphan_variant_row',
        row: rowNumber,
        col: columnMap.handle,
        columnName: headers[columnMap.handle ?? 0] ?? 'Handle',
        detail: 'Row has no Handle, so Shopify cannot attach it to a product.',
      });
      continue;
    }

    const handleKey = handleCell.value;
    let product = productsByHandle.get(handleKey);

    if (activeHandle !== null && activeHandle !== handleKey) {
      closedHandles.add(activeHandle);
    }

    if (product && closedHandles.has(handleKey)) {
      structuralIssues.push({
        kind: 'shopify_non_contiguous_handle',
        row: rowNumber,
        col: handleCell.ref.col,
        columnName: handleCell.ref.columnName,
        detail: `Handle "${handleKey}" appears again after other products. Shopify requires all rows for a handle to be grouped together.`,
        rawValue: handleCell.ref.raw,
      });
    }

    activeHandle = handleKey;

    if (!product) {
      const options: ProductOption[] = [];
      const optNameKeys = ['option1Name', 'option2Name', 'option3Name'] as const;
      for (const key of optNameKeys) {
        const optName = readCell(row, headers, rowNumber, columnMap[key]);
        if (optName) {
          options.push({ name: optName.value, nameRef: optName.ref, values: [] });
        }
      }

      product = {
        sourceRow: rowNumber,
        sourceRows: [rowNumber],
        handle: handleCell,
        title: titleCell,
        descriptionHtml: readCell(row, headers, rowNumber, columnMap.bodyHtml),
        vendor: readCell(row, headers, rowNumber, columnMap.vendor),
        productCategory: readCell(row, headers, rowNumber, columnMap.productCategory),
        productType: readCell(row, headers, rowNumber, columnMap.type),
        tags: splitCommaTags(readCell(row, headers, rowNumber, columnMap.tags)),
        categories: [],
        published: readCell(row, headers, rowNumber, columnMap.published),
        status: readCell(row, headers, rowNumber, columnMap.status),
        images: [],
        options,
        variants: [],
      };

      productsByHandle.set(handleKey, product);
      products.push(product);

      if (!titleCell && hasAnyVariantData(row, headers, rowNumber, columnMap)) {
        structuralIssues.push({
          kind: 'shopify_orphan_variant_row',
          row: rowNumber,
          col: columnMap.title,
          columnName: headers[columnMap.title ?? 0] ?? 'Title',
          detail: `First row for handle "${handleKey}" is missing a Title.`,
          rawValue: handleKey,
        });
      }
    } else {
      product.sourceRows.push(rowNumber);
    }

    if (imageSrcCell) {
      const img: ProductImage = {
        url: imageSrcCell,
        position: imagePosCell,
        alt: imageAltCell,
      };
      product.images.push(img);
    }

    const isFirstRow = product.sourceRow === rowNumber;
    const hasVariant = hasAnyVariantData(row, headers, rowNumber, columnMap);

    // Extra image-only row: subsequent row with Image Src and no variant fields.
    if (!isFirstRow && !hasVariant && imageSrcCell) {
      continue;
    }

    // Build variant for first row or any row with variant fields
    if (isFirstRow || hasVariant) {
      const variantPriceCell = readCell(row, headers, rowNumber, columnMap.variantPrice);
      const compareAtCell = readCell(row, headers, rowNumber, columnMap.variantCompareAtPrice);

      // Explicit Shopify price mapping:
      // - When Compare At Price is set, Compare At Price is regularPrice and Variant Price is salePrice.
      // - When Compare At Price is blank, Variant Price is regularPrice and salePrice is undefined.
      const regularPrice = compareAtCell ?? variantPriceCell;
      const salePrice = compareAtCell ? variantPriceCell : undefined;

      const optValues: Array<{ name: string; value: TrackedString }> = [];
      const optValKeys = ['option1Value', 'option2Value', 'option3Value'] as const;
      const optNameKeys = ['option1Name', 'option2Name', 'option3Name'] as const;

      for (let idx = 0; idx < 3; idx++) {
        const valCell = readCell(row, headers, rowNumber, columnMap[optValKeys[idx]]);
        const rowOptName = readCell(row, headers, rowNumber, columnMap[optNameKeys[idx]]);
        const optName = product.options[idx]?.name ?? rowOptName?.value ?? `Option ${idx + 1}`;

        if (valCell) {
          if (!product.options[idx]) {
            product.options[idx] = { name: optName, nameRef: rowOptName?.ref, values: [] };
          }
          if (!product.options[idx].values.includes(valCell.value)) {
            product.options[idx].values.push(valCell.value);
          }
          optValues.push({ name: optName, value: valCell });
        }
      }

      const gramsCell = readCell(row, headers, rowNumber, columnMap.variantGrams);
      const weightUnitCell = readCell(row, headers, rowNumber, columnMap.variantWeightUnit);

      const isDefault =
        optValues.length === 1 &&
        optValues[0].name.toLowerCase() === 'title' &&
        optValues[0].value.value.toLowerCase() === 'default title';

      const variant: Variant = {
        sourceRow: rowNumber,
        sku: readCell(row, headers, rowNumber, columnMap.variantSku),
        regularPrice,
        salePrice,
        barcode: readCell(row, headers, rowNumber, columnMap.variantBarcode),
        inventoryQty: readCell(row, headers, rowNumber, columnMap.variantInventoryQty),
        inventoryTracker: readCell(row, headers, rowNumber, columnMap.variantInventoryTracker),
        inventoryPolicy: readCell(row, headers, rowNumber, columnMap.variantInventoryPolicy),
        fulfillmentService: readCell(row, headers, rowNumber, columnMap.variantFulfillmentService),
        weight: gramsCell,
        weightGrams: gramsCell ? parseWeightToGrams(gramsCell.value, 'g') : undefined,
        weightUnit: weightUnitCell?.value ?? 'g',
        optionValues: optValues,
        image: readCell(row, headers, rowNumber, columnMap.variantImage),
        isDefaultVariant: isDefault,
      };

      product.variants.push(variant);
    }
  }

  // Post-grouping Shopify variant structural checks (late 2023 rules)
  for (const product of products) {
    if (product.variants.length > SHOPIFY_MAX_VARIANTS_2023) {
      structuralIssues.push({
        kind: 'shopify_too_many_variants',
        row: product.sourceRow,
        col: product.handle?.ref.col,
        columnName: product.handle?.ref.columnName ?? 'Handle',
        detail: `Product "${product.handle?.value ?? product.title?.value ?? ''}" has ${
          product.variants.length
        } variants. Shopify allows at most ${SHOPIFY_MAX_VARIANTS_2023} variants per product.`,
        rawValue: product.handle?.value,
      });
    }

    if (product.variants.length > 1) {
      const expectedOptCount = Math.max(1, product.options.length);
      for (const variant of product.variants) {
        if (variant.optionValues.length < expectedOptCount) {
          structuralIssues.push({
            kind: 'shopify_missing_option_value',
            row: variant.sourceRow,
            col: columnMap.option1Value,
            columnName: headers[columnMap.option1Value ?? 0] ?? 'Option1 Value',
            detail: `Variant row for "${
              product.handle?.value ?? ''
            }" is missing required option values.`,
          });
        }
      }
    }
  }

  return {
    platform: 'shopify',
    headers,
    rowCount: rows.length,
    products,
    structuralIssues,
    columnMap,
    extraColumns,
  };
}

export const SHOPIFY_EXPORT_HEADERS = [
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Fulfillment Service',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Variant Image',
  'Variant Weight Unit',
  'Status',
] as const;

function slugifyHandle(input: string, fallbackIndex: number): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || `product-${fallbackIndex}`;
}

function formatCleanDecimalPrice(raw: string | undefined): string {
  if (!raw) return '';
  const parsed = parsePriceValue(raw);
  return parsed.ok ? parsed.normalizedNumber : raw.trim();
}

function mapStatusToShopify(rawStatus: string | undefined): { status: string; published: string } {
  if (!rawStatus) return { status: 'active', published: 'TRUE' };
  const lower = rawStatus.trim().toLowerCase();
  if (lower === 'draft' || lower === '-1' || lower === 'false' || lower === '0') {
    return { status: 'draft', published: 'FALSE' };
  }
  if (lower === 'archived') {
    return { status: 'archived', published: 'FALSE' };
  }
  return { status: 'active', published: 'TRUE' };
}

export function writeShopifyCatalog(catalog: CatalogModel): {
  headers: string[];
  rows: string[][];
} {
  const headers = [...SHOPIFY_EXPORT_HEADERS];
  const rows: string[][] = [];
  const usedHandles = new Set<string>();

  for (let pIdx = 0; pIdx < catalog.products.length; pIdx++) {
    const product = catalog.products[pIdx];
    const baseHandle =
      product.handle?.value.trim() ||
      slugifyHandle(
        product.itemGroupId?.value || product.title?.value || product.id?.value || '',
        pIdx + 1,
      );

    let handle = baseHandle;
    let suffix = 2;
    while (usedHandles.has(handle)) {
      handle = `${baseHandle}-${suffix++}`;
    }
    usedHandles.add(handle);

    const { status, published } = mapStatusToShopify(product.status?.value);
    const finalPublished =
      product.published?.value.toUpperCase() === 'FALSE'
        ? 'FALSE'
        : product.published?.value.toUpperCase() === 'TRUE'
          ? 'TRUE'
          : published;

    const productOptions = product.options.slice(0, SHOPIFY_MAX_OPTIONS_2023);
    const variants: Variant[] =
      product.variants.length > 0
        ? product.variants
        : [{ sourceRow: product.sourceRow, optionValues: [] }];

    const isSingleDefault =
      variants.length === 1 &&
      (variants[0].isDefaultVariant ||
        (productOptions.length === 0 && variants[0].optionValues.length === 0));

    const optNames = isSingleDefault
      ? ['Title', '', '']
      : [
          productOptions[0]?.name ?? variants[0].optionValues[0]?.name ?? '',
          productOptions[1]?.name ?? variants[0].optionValues[1]?.name ?? '',
          productOptions[2]?.name ?? variants[0].optionValues[2]?.name ?? '',
        ];

    const firstImage = product.images[0];
    const extraImages = product.images.slice(1);

    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const variant = variants[vIdx];
      const isFirst = vIdx === 0;

      const optVals = isSingleDefault
        ? ['Default Title', '', '']
        : [0, 1, 2].map((oIdx) => {
            const name = optNames[oIdx];
            if (!name) return '';
            const matched = variant.optionValues.find(
              (ov) => ov.name.toLowerCase() === name.toLowerCase(),
            );
            return matched?.value.value ?? variant.optionValues[oIdx]?.value.value ?? '';
          });

      // Explicit Shopify price mapping:
      // On sale -> Variant Price = salePrice, Variant Compare At Price = regularPrice
      // Not on sale -> Variant Price = regularPrice, Variant Compare At Price = ''
      const hasSale = Boolean(variant.salePrice?.value);
      const variantPrice = hasSale
        ? formatCleanDecimalPrice(variant.salePrice?.value)
        : formatCleanDecimalPrice(variant.regularPrice?.value);
      const compareAtPrice = hasSale ? formatCleanDecimalPrice(variant.regularPrice?.value) : '';

      const grams =
        variant.weightGrams !== undefined && variant.weightGrams !== null
          ? String(variant.weightGrams)
          : (variant.weight?.value ?? '');

      const qty = variant.inventoryQty?.value ?? '';
      const tracker = variant.inventoryTracker?.value ?? (qty ? 'shopify' : '');
      const policy = variant.inventoryPolicy?.value.toLowerCase() || 'deny';
      const fulfillment = variant.fulfillmentService?.value || 'manual';

      const row = [
        handle,
        isFirst ? (product.title?.value ?? '') : '',
        isFirst ? (product.descriptionHtml?.value ?? '') : '',
        isFirst ? (product.vendor?.value ?? '') : '',
        isFirst ? (product.productCategory?.value ?? '') : '',
        isFirst ? (product.productType?.value ?? '') : '',
        isFirst ? product.tags.map((t) => t.value).join(', ') : '',
        isFirst ? finalPublished : '',
        isFirst ? optNames[0] : optNames[0] ? optNames[0] : '',
        optVals[0],
        isFirst ? optNames[1] : optNames[1] ? optNames[1] : '',
        optVals[1],
        isFirst ? optNames[2] : optNames[2] ? optNames[2] : '',
        optVals[2],
        variant.sku?.value ?? '',
        grams,
        tracker,
        qty,
        policy,
        fulfillment,
        variantPrice,
        compareAtPrice,
        variant.barcode?.value ?? '',
        isFirst ? (firstImage?.url.value ?? '') : '',
        isFirst && firstImage ? (firstImage.position?.value ?? '1') : '',
        isFirst ? (firstImage?.alt?.value ?? '') : '',
        variant.image && variant.image.value !== firstImage?.url.value ? variant.image.value : '',
        grams ? 'g' : '',
        isFirst ? status : '',
      ];

      rows.push(row);
    }

    for (let imgIdx = 0; imgIdx < extraImages.length; imgIdx++) {
      const img = extraImages[imgIdx];
      const imgRow = new Array<string>(headers.length).fill('');
      imgRow[0] = handle;
      imgRow[23] = img.url.value;
      imgRow[24] = img.position?.value ?? String(imgIdx + 2);
      imgRow[25] = img.alt?.value ?? '';
      rows.push(imgRow);
    }
  }

  return { headers, rows };
}
