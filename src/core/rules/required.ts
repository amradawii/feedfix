import { Platform } from '../model';
import { createProblemId, Problem, RuleRunner } from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const REQUIRED_COLUMNS: Record<
  Exclude<Platform, 'other'>,
  Array<{ key: string; label: string }>
> = {
  shopify: [
    { key: 'handle', label: 'Handle' },
    { key: 'title', label: 'Title' },
    { key: 'variantPrice', label: 'Variant Price' },
  ],
  woocommerce: [
    { key: 'type', label: 'Type' },
    { key: 'name', label: 'Name' },
    { key: 'regularPrice', label: 'Regular price' },
  ],
  google: [
    { key: 'id', label: 'id' },
    { key: 'title', label: 'title' },
    { key: 'description', label: 'description' },
    { key: 'link', label: 'link' },
    { key: 'imageLink', label: 'image_link' },
    { key: 'availability', label: 'availability' },
    { key: 'price', label: 'price' },
  ],
};

function normalizeAvailabilityForCheck(raw: string | undefined): string {
  if (!raw) return '';
  const lower = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (lower === 'preorder' || lower === 'pre_order') return 'preorder';
  if (lower === 'backorder' || lower === 'back_order' || lower === 'on_backorder') {
    return 'backorder';
  }
  return lower;
}

function isIdentifierExistsNo(raw: string | undefined): boolean {
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === 'no' || lower === 'false';
}

export const requiredMissingColumnRule: RuleRunner = {
  meta: {
    id: 'required.missing-column',
    group: 'required',
    severity: 'fail',
    platforms: ['shopify', 'woocommerce', 'google'],
    title: 'Required column is missing',
    explanation: 'The target platform requires this column to import products.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform === 'other') return [];
    const required = REQUIRED_COLUMNS[catalog.platform];
    const problems: Problem[] = [];

    for (const req of required) {
      if (catalog.columnMap[req.key] === undefined) {
        problems.push({
          id: createProblemId('required.missing-column', 1, undefined, req.key),
          ruleId: 'required.missing-column',
          group: 'required',
          severity: 'fail',
          title: 'Required column is missing',
          message: `Missing required column "${req.label}".`,
          row: 1,
          columnName: req.label,
        });
      }
    }

    return problems;
  },
};

export const requiredMissingValueRule: RuleRunner = {
  meta: {
    id: 'required.missing-value',
    group: 'required',
    severity: 'fail',
    platforms: ['shopify', 'woocommerce', 'google'],
    title: 'Required field is blank',
    explanation: 'Rows missing required product values fail import or get rejected.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    const problems: Problem[] = [];

    if (catalog.platform === 'shopify') {
      for (const product of catalog.products) {
        if (!product.title && catalog.columnMap.title !== undefined) {
          problems.push({
            id: createProblemId(
              'required.missing-value',
              product.sourceRow,
              catalog.columnMap.title,
              'title',
            ),
            ruleId: 'required.missing-value',
            group: 'required',
            severity: 'fail',
            title: 'Required field is blank',
            message: `Product "${
              product.handle?.value ?? `row ${product.sourceRow}`
            }" is missing a Title.`,
            row: product.sourceRow,
            col: catalog.columnMap.title,
            columnName: catalog.headers[catalog.columnMap.title] ?? 'Title',
          });
        }
        for (const variant of product.variants) {
          if (!variant.regularPrice && catalog.columnMap.variantPrice !== undefined) {
            problems.push({
              id: createProblemId(
                'required.missing-value',
                variant.sourceRow,
                catalog.columnMap.variantPrice,
                'price',
              ),
              ruleId: 'required.missing-value',
              group: 'required',
              severity: 'fail',
              title: 'Required field is blank',
              message: `Variant on row ${variant.sourceRow} is missing Variant Price.`,
              row: variant.sourceRow,
              col: catalog.columnMap.variantPrice,
              columnName: catalog.headers[catalog.columnMap.variantPrice] ?? 'Variant Price',
            });
          }
        }
      }
    } else if (catalog.platform === 'woocommerce') {
      for (const product of catalog.products) {
        const isVariable = product.wooType?.value.toLowerCase().includes('variable') ?? false;
        if (!product.title && catalog.columnMap.name !== undefined) {
          problems.push({
            id: createProblemId(
              'required.missing-value',
              product.sourceRow,
              catalog.columnMap.name,
              'name',
            ),
            ruleId: 'required.missing-value',
            group: 'required',
            severity: 'fail',
            title: 'Required field is blank',
            message: `Row ${product.sourceRow} is missing a product Name.`,
            row: product.sourceRow,
            col: catalog.columnMap.name,
            columnName: catalog.headers[catalog.columnMap.name] ?? 'Name',
          });
        }
        if (isVariable && product.variants.length === 0) {
          continue;
        }
        for (const variant of product.variants) {
          if (!variant.regularPrice && catalog.columnMap.regularPrice !== undefined) {
            problems.push({
              id: createProblemId(
                'required.missing-value',
                variant.sourceRow,
                catalog.columnMap.regularPrice,
                'price',
              ),
              ruleId: 'required.missing-value',
              group: 'required',
              severity: 'fail',
              title: 'Required field is blank',
              message: `Row ${variant.sourceRow} is missing Regular price.`,
              row: variant.sourceRow,
              col: catalog.columnMap.regularPrice,
              columnName: catalog.headers[catalog.columnMap.regularPrice] ?? 'Regular price',
            });
          }
        }
      }
    } else if (catalog.platform === 'google') {
      for (const product of catalog.products) {
        for (const variant of product.variants) {
          const checks: Array<{ present: boolean; key: string; label: string }> = [
            { present: Boolean(variant.id), key: 'id', label: 'id' },
            { present: Boolean(product.title), key: 'title', label: 'title' },
            { present: Boolean(product.descriptionHtml), key: 'description', label: 'description' },
            { present: Boolean(variant.link ?? product.link), key: 'link', label: 'link' },
            { present: Boolean(variant.image), key: 'imageLink', label: 'image_link' },
            {
              present: Boolean(variant.availability),
              key: 'availability',
              label: 'availability',
            },
            { present: Boolean(variant.regularPrice), key: 'price', label: 'price' },
          ];

          for (const check of checks) {
            if (!check.present && catalog.columnMap[check.key] !== undefined) {
              const col = catalog.columnMap[check.key];
              problems.push({
                id: createProblemId('required.missing-value', variant.sourceRow, col, check.key),
                ruleId: 'required.missing-value',
                group: 'required',
                severity: 'fail',
                title: 'Required field is blank',
                message: `Row ${variant.sourceRow} is missing required Google attribute "${check.label}".`,
                row: variant.sourceRow,
                col,
                columnName: catalog.headers[col] ?? check.label,
              });
            }
          }
        }
      }
    }

    return problems;
  },
};

export const requiredShopifyVariantDefaultsRule: RuleRunner = {
  meta: {
    id: 'required.shopify-variant-defaults',
    group: 'required',
    severity: 'reject',
    platforms: ['shopify'],
    title: 'Shopify variant missing inventory policy or fulfillment service',
    explanation:
      'Shopify requires Variant Inventory Policy (deny/continue) and Variant Fulfillment Service (manual) when creating new variants.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    const problems: Problem[] = [];
    const hasPolicyCol = catalog.columnMap.variantInventoryPolicy !== undefined;
    const hasFulfillCol = catalog.columnMap.variantFulfillmentService !== undefined;

    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (hasPolicyCol && !variant.inventoryPolicy) {
          const col = catalog.columnMap.variantInventoryPolicy;
          problems.push({
            id: createProblemId('required.shopify-variant-defaults', variant.sourceRow, col),
            ruleId: 'required.shopify-variant-defaults',
            group: 'required',
            severity: 'reject',
            title: 'Shopify variant missing inventory policy or fulfillment service',
            message: `Row ${variant.sourceRow} is missing Variant Inventory Policy (expected "deny" or "continue").`,
            row: variant.sourceRow,
            col,
            columnName: catalog.headers[col] ?? 'Variant Inventory Policy',
          });
        }
        if (hasFulfillCol && !variant.fulfillmentService) {
          const col = catalog.columnMap.variantFulfillmentService;
          problems.push({
            id: createProblemId('required.shopify-variant-defaults', variant.sourceRow, col),
            ruleId: 'required.shopify-variant-defaults',
            group: 'required',
            severity: 'reject',
            title: 'Shopify variant missing inventory policy or fulfillment service',
            message: `Row ${variant.sourceRow} is missing Variant Fulfillment Service (expected "manual" or app handle).`,
            row: variant.sourceRow,
            col,
            columnName: catalog.headers[col] ?? 'Variant Fulfillment Service',
          });
        }
      }
    }

    return problems;
  },
};

export const requiredGoogleAvailabilityDateRule: RuleRunner = {
  meta: {
    id: 'required.google-availability-date',
    group: 'required',
    severity: 'fail',
    platforms: ['google'],
    title: 'Missing or invalid availability_date for preorder/backorder',
    explanation:
      'Google Merchant Center requires availability_date in ISO 8601 format whenever availability is preorder or backorder.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];
    const dateCol = catalog.columnMap.availabilityDate;

    for (const product of catalog.products) {
      for (const variant of product.variants) {
        const avail = normalizeAvailabilityForCheck(variant.availability?.value);
        if (avail !== 'preorder' && avail !== 'backorder') continue;

        if (!variant.availabilityDate) {
          problems.push({
            id: createProblemId(
              'required.google-availability-date',
              variant.sourceRow,
              dateCol,
              'missing',
            ),
            ruleId: 'required.google-availability-date',
            group: 'required',
            severity: 'fail',
            title: 'Missing or invalid availability_date for preorder/backorder',
            message: `Row ${variant.sourceRow} has availability "${avail}" without availability_date.`,
            row: variant.sourceRow,
            col: dateCol,
            columnName: dateCol !== undefined ? catalog.headers[dateCol] : 'availability_date',
          });
        } else if (!ISO_DATE_RE.test(variant.availabilityDate.value)) {
          problems.push({
            id: createProblemId(
              'required.google-availability-date',
              variant.availabilityDate.ref.row,
              variant.availabilityDate.ref.col,
              'format',
            ),
            ruleId: 'required.google-availability-date',
            group: 'required',
            severity: 'fail',
            title: 'Missing or invalid availability_date for preorder/backorder',
            message: `availability_date "${variant.availabilityDate.value}" is not ISO 8601 (expected YYYY-MM-DD or YYYY-MM-DDThh:mm+00:00).`,
            row: variant.availabilityDate.ref.row,
            col: variant.availabilityDate.ref.col,
            columnName: variant.availabilityDate.ref.columnName,
            rawValue: variant.availabilityDate.ref.raw,
          });
        }
      }
    }

    return problems;
  },
};

export const requiredGoogleIdentifiersRule: RuleRunner = {
  meta: {
    id: 'required.google-identifiers',
    group: 'required',
    severity: 'reject',
    platforms: ['google'],
    title: 'Missing or conflicting Google product identifiers',
    explanation:
      'Branded items need brand and gtin (or mpn). Custom goods without barcodes should set identifier_exists to no.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];

    for (const product of catalog.products) {
      for (const variant of product.variants) {
        const noIds = isIdentifierExistsNo(variant.identifierExists?.value);
        const hasGtin = Boolean(variant.barcode);
        const hasMpn = Boolean(variant.mpn);
        const hasBrand = Boolean(product.vendor);

        if (noIds) {
          if (hasGtin || hasMpn) {
            const ref = variant.identifierExists?.ref;
            problems.push({
              id: createProblemId(
                'required.google-identifiers',
                variant.sourceRow,
                ref?.col,
                'conflict',
              ),
              ruleId: 'required.google-identifiers',
              group: 'required',
              severity: 'reject',
              title: 'Missing or conflicting Google product identifiers',
              message: `Row ${variant.sourceRow} sets identifier_exists to "${variant.identifierExists?.value}" while also providing a GTIN or MPN.`,
              row: variant.sourceRow,
              col: ref?.col,
              columnName: ref?.columnName ?? 'identifier_exists',
              rawValue: ref?.raw,
            });
          }
          continue;
        }

        if (!hasBrand) {
          const brandCol = catalog.columnMap.brand;
          problems.push({
            id: createProblemId(
              'required.google-identifiers',
              variant.sourceRow,
              brandCol,
              'brand',
            ),
            ruleId: 'required.google-identifiers',
            group: 'required',
            severity: 'reject',
            title: 'Missing or conflicting Google product identifiers',
            message: `Row ${variant.sourceRow} is missing brand (required unless identifier_exists is "no").`,
            row: variant.sourceRow,
            col: brandCol,
            columnName: brandCol !== undefined ? catalog.headers[brandCol] : 'brand',
          });
        }

        if (!hasGtin && !hasMpn) {
          const gtinCol = catalog.columnMap.gtin;
          problems.push({
            id: createProblemId('required.google-identifiers', variant.sourceRow, gtinCol, 'gtin'),
            ruleId: 'required.google-identifiers',
            group: 'required',
            severity: 'reject',
            title: 'Missing or conflicting Google product identifiers',
            message: `Row ${variant.sourceRow} is missing gtin and mpn (add a barcode/MPN or set identifier_exists to "no" for custom goods).`,
            row: variant.sourceRow,
            col: gtinCol,
            columnName: gtinCol !== undefined ? catalog.headers[gtinCol] : 'gtin',
          });
        }
      }
    }

    return problems;
  },
};

export const REQUIRED_RULES: RuleRunner[] = [
  requiredMissingColumnRule,
  requiredMissingValueRule,
  requiredShopifyVariantDefaultsRule,
  requiredGoogleAvailabilityDateRule,
  requiredGoogleIdentifiersRule,
];
