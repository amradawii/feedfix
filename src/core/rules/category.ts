import { createProblemId, Problem, RuleRunner } from './types';

export const categoryGoogleTaxonomyRule: RuleRunner = {
  meta: {
    id: 'category.google-taxonomy',
    group: 'category',
    severity: 'reject',
    platforms: ['google'],
    title: 'Unknown Google product category',
    explanation:
      'google_product_category must be an official numeric ID or full category path from the Google Product Taxonomy (2021-09-21).',
    hasSafeFix: false,
  },
  run: ({ catalog, googleTaxonomy }) => {
    if (catalog.platform !== 'google' || !googleTaxonomy) return [];
    const problems: Problem[] = [];

    for (const product of catalog.products) {
      const cat = product.productCategory;
      if (!cat) continue;
      if (googleTaxonomy.isValid(cat.value)) continue;

      problems.push({
        id: createProblemId('category.google-taxonomy', cat.ref.row, cat.ref.col),
        ruleId: 'category.google-taxonomy',
        group: 'category',
        severity: 'reject',
        title: 'Unknown Google product category',
        message: `Google category "${cat.value}" was not found in the official Google Product Taxonomy.`,
        row: cat.ref.row,
        col: cat.ref.col,
        columnName: cat.ref.columnName,
        rawValue: cat.ref.raw,
      });
    }

    return problems;
  },
};

export const CATEGORY_RULES: RuleRunner[] = [categoryGoogleTaxonomyRule];
