import { TrackedString } from '../model';
import { createProblemId, Problem, RuleRunner, Severity } from './types';

function makeEnumCheck(params: {
  ruleId: string;
  severity: Severity;
  title: string;
  fieldLabel: string;
  allowed: Set<string>;
  allowedListText: string;
  mapAlias: (normalized: string) => string | null;
  tracked: TrackedString;
}): Problem | null {
  const { ruleId, severity, title, fieldLabel, allowed, allowedListText, mapAlias, tracked } =
    params;
  const rawTrimmed = tracked.value;
  if (allowed.has(rawTrimmed)) {
    return null;
  }

  const normalized = rawTrimmed
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
  const mapped = mapAlias(normalized);

  if (mapped) {
    return {
      id: createProblemId(ruleId, tracked.ref.row, tracked.ref.col),
      ruleId,
      group: 'values',
      severity,
      title,
      message: `${fieldLabel} "${rawTrimmed}" should be "${mapped}".`,
      row: tracked.ref.row,
      col: tracked.ref.col,
      columnName: tracked.ref.columnName,
      rawValue: tracked.ref.raw,
      fix: {
        safe: true,
        description: `Change ${fieldLabel} to "${mapped}"`,
        edits: [
          {
            row: tracked.ref.row,
            col: tracked.ref.col,
            columnName: tracked.ref.columnName,
            before: tracked.ref.raw,
            after: mapped,
          },
        ],
      },
    };
  }

  return {
    id: createProblemId(ruleId, tracked.ref.row, tracked.ref.col),
    ruleId,
    group: 'values',
    severity,
    title,
    message: `${fieldLabel} "${rawTrimmed}" is not valid (allowed: ${allowedListText}).`,
    row: tracked.ref.row,
    col: tracked.ref.col,
    columnName: tracked.ref.columnName,
    rawValue: tracked.ref.raw,
  };
}

const GOOGLE_AVAILABILITY_ALLOWED = new Set(['in_stock', 'out_of_stock', 'preorder', 'backorder']);
const GOOGLE_AVAILABILITY_MAP: Record<string, string> = {
  'in stock': 'in_stock',
  instock: 'in_stock',
  available: 'in_stock',
  'available for order': 'in_stock',
  yes: 'in_stock',
  true: 'in_stock',
  '1': 'in_stock',
  'out of stock': 'out_of_stock',
  outofstock: 'out_of_stock',
  unavailable: 'out_of_stock',
  'sold out': 'out_of_stock',
  soldout: 'out_of_stock',
  no: 'out_of_stock',
  false: 'out_of_stock',
  '0': 'out_of_stock',
  preorder: 'preorder',
  'pre order': 'preorder',
  backorder: 'backorder',
  'back order': 'backorder',
  'on backorder': 'backorder',
};

const GOOGLE_CONDITION_ALLOWED = new Set(['new', 'refurbished', 'used']);
const GOOGLE_CONDITION_MAP: Record<string, string> = {
  new: 'new',
  'brand new': 'new',
  refurbished: 'refurbished',
  renewed: 'refurbished',
  used: 'used',
  'pre owned': 'used',
  preowned: 'used',
  'second hand': 'used',
};

const GOOGLE_ID_EXISTS_ALLOWED = new Set(['yes', 'no', 'true', 'false']);
const GOOGLE_ID_EXISTS_MAP: Record<string, string> = {
  yes: 'yes',
  true: 'yes',
  '1': 'yes',
  no: 'no',
  false: 'no',
  '0': 'no',
};

const SHOPIFY_STATUS_ALLOWED = new Set(['active', 'draft', 'archived']);
const SHOPIFY_STATUS_MAP: Record<string, string> = {
  active: 'active',
  published: 'active',
  live: 'active',
  draft: 'draft',
  unpublished: 'draft',
  archived: 'archived',
};

const SHOPIFY_PUBLISHED_ALLOWED = new Set(['TRUE', 'FALSE']);
const SHOPIFY_PUBLISHED_MAP: Record<string, string> = {
  true: 'TRUE',
  yes: 'TRUE',
  '1': 'TRUE',
  false: 'FALSE',
  no: 'FALSE',
  '0': 'FALSE',
};

const SHOPIFY_POLICY_ALLOWED = new Set(['deny', 'continue']);
const SHOPIFY_POLICY_MAP: Record<string, string> = {
  deny: 'deny',
  continue: 'continue',
};

const WOO_PUBLISHED_ALLOWED = new Set(['1', '0', '-1', '2']);
const WOO_PUBLISHED_MAP: Record<string, string> = {
  true: '1',
  yes: '1',
  publish: '1',
  published: '1',
  active: '1',
  private: '0',
  false: '-1',
  no: '-1',
  draft: '-1',
  pending: '2',
};

const WOO_INSTOCK_ALLOWED = new Set(['1', '0', 'backorder']);
const WOO_INSTOCK_MAP: Record<string, string> = {
  'in stock': '1',
  instock: '1',
  yes: '1',
  true: '1',
  'out of stock': '0',
  outofstock: '0',
  no: '0',
  false: '0',
  backorder: 'backorder',
  'back order': 'backorder',
  'on backorder': 'backorder',
};

export const valuesGoogleAvailabilityRule: RuleRunner = {
  meta: {
    id: 'values.google-availability',
    group: 'values',
    severity: 'fail',
    platforms: ['google'],
    title: 'Invalid Google availability value',
    explanation: 'Google Merchant Center expects in_stock, out_of_stock, preorder or backorder.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.availability) continue;
        const p = makeEnumCheck({
          ruleId: 'values.google-availability',
          severity: 'fail',
          title: 'Invalid Google availability value',
          fieldLabel: 'availability',
          allowed: GOOGLE_AVAILABILITY_ALLOWED,
          allowedListText: 'in_stock, out_of_stock, preorder, backorder',
          mapAlias: (norm) => GOOGLE_AVAILABILITY_MAP[norm] ?? null,
          tracked: variant.availability,
        });
        if (p) problems.push(p);
      }
    }
    return problems;
  },
};

export const valuesGoogleConditionRule: RuleRunner = {
  meta: {
    id: 'values.google-condition',
    group: 'values',
    severity: 'fail',
    platforms: ['google'],
    title: 'Invalid Google condition value',
    explanation: 'Google Merchant Center expects new, refurbished or used (lowercase).',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.condition) continue;
        const p = makeEnumCheck({
          ruleId: 'values.google-condition',
          severity: 'fail',
          title: 'Invalid Google condition value',
          fieldLabel: 'condition',
          allowed: GOOGLE_CONDITION_ALLOWED,
          allowedListText: 'new, refurbished, used',
          mapAlias: (norm) => GOOGLE_CONDITION_MAP[norm] ?? null,
          tracked: variant.condition,
        });
        if (p) problems.push(p);
      }
    }
    return problems;
  },
};

export const valuesGoogleIdentifierExistsRule: RuleRunner = {
  meta: {
    id: 'values.google-identifier-exists',
    group: 'values',
    severity: 'reject',
    platforms: ['google'],
    title: 'Invalid identifier_exists value',
    explanation: 'Google expects yes or no (or true/false) in lowercase for identifier_exists.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.identifierExists) continue;
        const p = makeEnumCheck({
          ruleId: 'values.google-identifier-exists',
          severity: 'reject',
          title: 'Invalid identifier_exists value',
          fieldLabel: 'identifier_exists',
          allowed: GOOGLE_ID_EXISTS_ALLOWED,
          allowedListText: 'yes, no, true, false',
          mapAlias: (norm) => GOOGLE_ID_EXISTS_MAP[norm] ?? null,
          tracked: variant.identifierExists,
        });
        if (p) problems.push(p);
      }
    }
    return problems;
  },
};

export const valuesShopifyStatusRule: RuleRunner = {
  meta: {
    id: 'values.shopify-status',
    group: 'values',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Invalid Shopify Status value',
    explanation: 'Shopify Status must be active, draft or archived (lowercase).',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      if (!product.status) continue;
      const p = makeEnumCheck({
        ruleId: 'values.shopify-status',
        severity: 'fail',
        title: 'Invalid Shopify Status value',
        fieldLabel: 'Status',
        allowed: SHOPIFY_STATUS_ALLOWED,
        allowedListText: 'active, draft, archived',
        mapAlias: (norm) => SHOPIFY_STATUS_MAP[norm] ?? null,
        tracked: product.status,
      });
      if (p) problems.push(p);
    }
    return problems;
  },
};

export const valuesShopifyPublishedRule: RuleRunner = {
  meta: {
    id: 'values.shopify-published',
    group: 'values',
    severity: 'reject',
    platforms: ['shopify'],
    title: 'Invalid Shopify Published value',
    explanation: 'Shopify Published expects TRUE or FALSE.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      if (!product.published) continue;
      const p = makeEnumCheck({
        ruleId: 'values.shopify-published',
        severity: 'reject',
        title: 'Invalid Shopify Published value',
        fieldLabel: 'Published',
        allowed: SHOPIFY_PUBLISHED_ALLOWED,
        allowedListText: 'TRUE, FALSE',
        mapAlias: (norm) => SHOPIFY_PUBLISHED_MAP[norm] ?? null,
        tracked: product.published,
      });
      if (p) problems.push(p);
    }
    return problems;
  },
};

export const valuesShopifyInventoryPolicyRule: RuleRunner = {
  meta: {
    id: 'values.shopify-inventory-policy',
    group: 'values',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Invalid Shopify Variant Inventory Policy',
    explanation: 'Shopify Variant Inventory Policy must be deny or continue.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.inventoryPolicy) continue;
        const p = makeEnumCheck({
          ruleId: 'values.shopify-inventory-policy',
          severity: 'fail',
          title: 'Invalid Shopify Variant Inventory Policy',
          fieldLabel: 'Variant Inventory Policy',
          allowed: SHOPIFY_POLICY_ALLOWED,
          allowedListText: 'deny, continue',
          mapAlias: (norm) => SHOPIFY_POLICY_MAP[norm] ?? null,
          tracked: variant.inventoryPolicy,
        });
        if (p) problems.push(p);
      }
    }
    return problems;
  },
};

export const valuesWooPublishedRule: RuleRunner = {
  meta: {
    id: 'values.woo-published',
    group: 'values',
    severity: 'reject',
    platforms: ['woocommerce'],
    title: 'Non-standard WooCommerce Published value',
    explanation: 'WooCommerce uses 1 (published), 0 (private), -1 (draft) or 2 (pending).',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'woocommerce') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      if (!product.status) continue;
      const p = makeEnumCheck({
        ruleId: 'values.woo-published',
        severity: 'reject',
        title: 'Non-standard WooCommerce Published value',
        fieldLabel: 'Published',
        allowed: WOO_PUBLISHED_ALLOWED,
        allowedListText: '1, 0, -1, 2',
        mapAlias: (norm) => WOO_PUBLISHED_MAP[norm] ?? null,
        tracked: product.status,
      });
      if (p) problems.push(p);
    }
    return problems;
  },
};

export const valuesWooInStockRule: RuleRunner = {
  meta: {
    id: 'values.woo-in-stock',
    group: 'values',
    severity: 'reject',
    platforms: ['woocommerce'],
    title: 'Non-standard WooCommerce In stock? value',
    explanation: 'WooCommerce expects 1 (in stock), 0 (out of stock) or backorder.',
    hasSafeFix: true,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'woocommerce') return [];
    const problems: Problem[] = [];
    for (const product of catalog.products) {
      for (const variant of product.variants) {
        if (!variant.availability) continue;
        const p = makeEnumCheck({
          ruleId: 'values.woo-in-stock',
          severity: 'reject',
          title: 'Non-standard WooCommerce In stock? value',
          fieldLabel: 'In stock?',
          allowed: WOO_INSTOCK_ALLOWED,
          allowedListText: '1, 0, backorder',
          mapAlias: (norm) => WOO_INSTOCK_MAP[norm] ?? null,
          tracked: variant.availability,
        });
        if (p) problems.push(p);
      }
    }
    return problems;
  },
};

export const VALUE_RULES: RuleRunner[] = [
  valuesGoogleAvailabilityRule,
  valuesGoogleConditionRule,
  valuesGoogleIdentifierExistsRule,
  valuesShopifyStatusRule,
  valuesShopifyPublishedRule,
  valuesShopifyInventoryPolicyRule,
  valuesWooPublishedRule,
  valuesWooInStockRule,
];
