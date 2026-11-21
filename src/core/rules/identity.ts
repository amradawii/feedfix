import { TrackedString } from '../model';
import { ALL_PLATFORMS, createProblemId, Problem, RuleRunner } from './types';

function formatRowList(rows: number[]): string {
  if (rows.length <= 4) {
    return rows.join(', ');
  }
  return `${rows.slice(0, 4).join(', ')} (+${rows.length - 4} more)`;
}

export const identityDuplicateSkuRule: RuleRunner = {
  meta: {
    id: 'identity.duplicate-sku',
    group: 'identity',
    severity: 'reject',
    platforms: ['shopify', 'woocommerce', 'other'],
    title: 'Duplicate SKU',
    explanation:
      'Multiple products or variants share the same SKU, which causes import conflicts or stock errors.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform === 'google') return [];

    const bySku = new Map<string, TrackedString[]>();

    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.sku) continue;
        const key = variant.sku.value.toLowerCase();
        const bucket = bySku.get(key) ?? [];
        bucket.push(variant.sku);
        bySku.set(key, bucket);
      }
    }

    const problems: Problem[] = [];
    for (const group of bySku.values()) {
      if (group.length <= 1) continue;
      const rows = group.map((g) => g.ref.row);
      const rowList = formatRowList(rows);
      for (const item of group) {
        problems.push({
          id: createProblemId('identity.duplicate-sku', item.ref.row, item.ref.col),
          ruleId: 'identity.duplicate-sku',
          group: 'identity',
          severity: 'reject',
          title: 'Duplicate SKU',
          message: `Duplicate SKU "${item.value}" appears on rows ${rowList}.`,
          row: item.ref.row,
          col: item.ref.col,
          columnName: item.ref.columnName,
          rawValue: item.ref.raw,
        });
      }
    }

    return problems;
  },
};

export const identityDuplicateIdRule: RuleRunner = {
  meta: {
    id: 'identity.duplicate-id',
    group: 'identity',
    severity: 'fail',
    platforms: ['google', 'woocommerce', 'other'],
    title: 'Duplicate product ID',
    explanation: 'Each row must have a unique ID; duplicates overwrite or fail during import.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform === 'shopify') return [];

    const byId = new Map<string, TrackedString[]>();
    const seenRowCol = new Set<string>();

    const record = (tracked?: TrackedString) => {
      if (!tracked) return;
      const dedupKey = `${tracked.ref.row}:${tracked.ref.col}`;
      if (seenRowCol.has(dedupKey)) return;
      seenRowCol.add(dedupKey);
      const key = tracked.value.toLowerCase();
      const bucket = byId.get(key) ?? [];
      bucket.push(tracked);
      byId.set(key, bucket);
    };

    for (const product of catalog.products) {
      record(product.id);
      for (const variant of product.variants) {
        record(variant.id);
      }
    }

    const problems: Problem[] = [];
    for (const group of byId.values()) {
      if (group.length <= 1) continue;
      const rows = group.map((g) => g.ref.row);
      const rowList = formatRowList(rows);
      for (const item of group) {
        problems.push({
          id: createProblemId('identity.duplicate-id', item.ref.row, item.ref.col),
          ruleId: 'identity.duplicate-id',
          group: 'identity',
          severity: 'fail',
          title: 'Duplicate product ID',
          message: `Duplicate ID "${item.value}" appears on rows ${rowList}.`,
          row: item.ref.row,
          col: item.ref.col,
          columnName: item.ref.columnName,
          rawValue: item.ref.raw,
        });
      }
    }

    return problems;
  },
};

export const identityDuplicateHandleRule: RuleRunner = {
  meta: {
    id: 'identity.duplicate-handle',
    group: 'identity',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Product handle is split across non-adjacent rows',
    explanation:
      'Shopify expects all rows with the same Handle to be next to each other; split handles can import as separate or broken products.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];

    return catalog.structuralIssues
      .filter((iss) => iss.kind === 'shopify_non_contiguous_handle')
      .map((iss) => ({
        id: createProblemId('identity.duplicate-handle', iss.row, iss.col),
        ruleId: 'identity.duplicate-handle',
        group: 'identity',
        severity: 'fail',
        title: 'Product handle is split across non-adjacent rows',
        message: iss.detail,
        row: iss.row,
        col: iss.col,
        columnName: iss.columnName,
        rawValue: iss.rawValue,
      }));
  },
};

export const identityEmptyVariantSkuRule: RuleRunner = {
  meta: {
    id: 'identity.empty-variant-sku',
    group: 'identity',
    severity: 'tip',
    platforms: ALL_PLATFORMS,
    title: 'Variant has no SKU',
    explanation:
      'Multi-variant products are hard to track and sync without a SKU on every variant.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform === 'google') return [];

    const problems: Problem[] = [];
    const skuCol =
      catalog.platform === 'shopify' ? catalog.columnMap.variantSku : catalog.columnMap.sku;
    const skuColName =
      skuCol !== undefined
        ? catalog.headers[skuCol]
        : catalog.platform === 'shopify'
          ? 'Variant SKU'
          : 'SKU';

    for (const product of catalog.products) {
      if (product.variants.length <= 1) continue;
      for (const variant of product.variants) {
        if (!variant.sku) {
          problems.push({
            id: createProblemId('identity.empty-variant-sku', variant.sourceRow, skuCol),
            ruleId: 'identity.empty-variant-sku',
            group: 'identity',
            severity: 'tip',
            title: 'Variant has no SKU',
            message: `Variant on row ${variant.sourceRow} of "${
              product.title?.value ?? product.handle?.value ?? 'product'
            }" has an empty SKU.`,
            row: variant.sourceRow,
            col: skuCol,
            columnName: skuColName,
            rawValue: '',
          });
        }
      }
    }

    return problems;
  },
};

export const IDENTITY_RULES: RuleRunner[] = [
  identityDuplicateSkuRule,
  identityDuplicateIdRule,
  identityDuplicateHandleRule,
  identityEmptyVariantSkuRule,
];
