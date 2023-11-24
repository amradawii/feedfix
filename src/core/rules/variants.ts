import { createProblemId, Problem, RuleRunner } from './types';

export const variantsShopifyMissingOptionRule: RuleRunner = {
  meta: {
    id: 'variants.shopify-missing-option',
    group: 'variants',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Shopify variant is missing option values',
    explanation:
      'Every variant row in a multi-variant Shopify product must fill in its option values.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    return catalog.structuralIssues
      .filter((iss) => iss.kind === 'shopify_missing_option_value')
      .map((iss) => ({
        id: createProblemId('variants.shopify-missing-option', iss.row, iss.col),
        ruleId: 'variants.shopify-missing-option',
        group: 'variants',
        severity: 'fail',
        title: 'Shopify variant is missing option values',
        message: iss.detail,
        row: iss.row,
        col: iss.col,
        columnName: iss.columnName,
        rawValue: iss.rawValue,
      }));
  },
};

export const variantsShopifyOrphanRowRule: RuleRunner = {
  meta: {
    id: 'variants.shopify-orphan-row',
    group: 'variants',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Orphan Shopify row',
    explanation:
      'A variant row without a Handle (or a first row without a Title) cannot be grouped properly.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    return catalog.structuralIssues
      .filter((iss) => iss.kind === 'shopify_orphan_variant_row')
      .map((iss) => ({
        id: createProblemId('variants.shopify-orphan-row', iss.row, iss.col),
        ruleId: 'variants.shopify-orphan-row',
        group: 'variants',
        severity: 'fail',
        title: 'Orphan Shopify row',
        message: iss.detail,
        row: iss.row,
        col: iss.col,
        columnName: iss.columnName,
        rawValue: iss.rawValue,
      }));
  },
};

export const variantsShopifyLimitsRule: RuleRunner = {
  meta: {
    id: 'variants.shopify-limits',
    group: 'variants',
    severity: 'fail',
    platforms: ['shopify'],
    title: 'Exceeds Shopify option or variant limit',
    explanation: 'Shopify allows at most 3 options and 100 variants per product.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'shopify') return [];
    return catalog.structuralIssues
      .filter(
        (iss) =>
          iss.kind === 'shopify_too_many_options' || iss.kind === 'shopify_too_many_variants',
      )
      .map((iss, idx) => ({
        id: createProblemId('variants.shopify-limits', iss.row, iss.col, idx),
        ruleId: 'variants.shopify-limits',
        group: 'variants',
        severity: 'fail',
        title: 'Exceeds Shopify option or variant limit',
        message: iss.detail,
        row: iss.row,
        col: iss.col,
        columnName: iss.columnName,
        rawValue: iss.rawValue,
      }));
  },
};

export const variantsWooOrphanVariationRule: RuleRunner = {
  meta: {
    id: 'variants.woo-orphan-variation',
    group: 'variants',
    severity: 'fail',
    platforms: ['woocommerce'],
    title: 'WooCommerce variation has no matching parent',
    explanation:
      'Variation rows must reference an existing variable parent product by SKU or id:<ID> in the Parent column.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'woocommerce') return [];
    return catalog.structuralIssues
      .filter(
        (iss) =>
          iss.kind === 'woo_orphan_variation' || iss.kind === 'woo_variation_parent_not_variable',
      )
      .map(
        (iss): Problem => ({
          id: createProblemId('variants.woo-orphan-variation', iss.row, iss.col),
          ruleId: 'variants.woo-orphan-variation',
          group: 'variants',
          severity: 'fail',
          title: 'WooCommerce variation has no matching parent',
          message: iss.detail,
          row: iss.row,
          col: iss.col,
          columnName: iss.columnName,
          rawValue: iss.rawValue,
        }),
      );
  },
};

export const variantsGoogleMissingGroupIdRule: RuleRunner = {
  meta: {
    id: 'variants.google-missing-item-group-id',
    group: 'variants',
    severity: 'reject',
    platforms: ['google'],
    title: 'Google variants are missing item_group_id',
    explanation:
      'Items with the same title and variant attributes (color/size) should share an item_group_id.',
    hasSafeFix: false,
  },
  run: ({ catalog }) => {
    if (catalog.platform !== 'google') return [];
    return catalog.structuralIssues
      .filter((iss) => iss.kind === 'google_missing_item_group_id')
      .map((iss) => ({
        id: createProblemId('variants.google-missing-item-group-id', iss.row, iss.col),
        ruleId: 'variants.google-missing-item-group-id',
        group: 'variants',
        severity: 'reject',
        title: 'Google variants are missing item_group_id',
        message: iss.detail,
        row: iss.row,
        col: iss.col,
        columnName: iss.columnName,
        rawValue: iss.rawValue,
      }));
  },
};

export const VARIANT_RULES: RuleRunner[] = [
  variantsShopifyMissingOptionRule,
  variantsShopifyOrphanRowRule,
  variantsShopifyLimitsRule,
  variantsWooOrphanVariationRule,
  variantsGoogleMissingGroupIdRule,
];
