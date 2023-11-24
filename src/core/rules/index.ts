import { CatalogModel } from '../model';
import { ParsedCsv } from '../parse';
import { GoogleTaxonomy, loadGoogleTaxonomy } from '../platforms/google-taxonomy';
import { BARCODE_RULES } from './barcode';
import { CATEGORY_RULES } from './category';
import { FILE_RULES } from './file';
import { IDENTITY_RULES } from './identity';
import { LINK_RULES } from './links';
import { PRICE_RULES } from './price';
import { REQUIRED_RULES } from './required';
import { TEXT_RULES } from './text';
import {
  Problem,
  ProblemGroup,
  RuleEngineResult,
  RuleMeta,
  RuleRunner,
  RuleSummaryCounts,
  Severity,
} from './types';
import { VALUE_RULES } from './values';
import { VARIANT_RULES } from './variants';

export const ALL_RULES: RuleRunner[] = [
  ...FILE_RULES,
  ...REQUIRED_RULES,
  ...IDENTITY_RULES,
  ...PRICE_RULES,
  ...BARCODE_RULES,
  ...TEXT_RULES,
  ...LINK_RULES,
  ...VARIANT_RULES,
  ...VALUE_RULES,
  ...CATEGORY_RULES,
];

export const CORE_RULES = ALL_RULES;

const SEVERITY_ORDER: Record<Severity, number> = {
  fail: 0,
  reject: 1,
  tip: 2,
};

const RULES_BY_ID = new Map<string, RuleMeta>(ALL_RULES.map((r) => [r.meta.id, r.meta]));

export function getRuleMeta(ruleId: string): RuleMeta | undefined {
  return RULES_BY_ID.get(ruleId);
}

export interface RunRulesOptions {
  rules?: RuleRunner[];
  googleTaxonomy?: GoogleTaxonomy;
}

export function runRules(
  parsed: ParsedCsv,
  catalog: CatalogModel,
  optionsOrRules?: RunRulesOptions | RuleRunner[],
): RuleEngineResult {
  const rules = Array.isArray(optionsOrRules) ? optionsOrRules : optionsOrRules?.rules ?? ALL_RULES;
  const googleTaxonomy = Array.isArray(optionsOrRules) ? undefined : optionsOrRules?.googleTaxonomy;

  const problems: Problem[] = [];
  const metaMap = new Map<string, RuleMeta>();

  for (const runner of rules) {
    metaMap.set(runner.meta.id, runner.meta);
    if (!runner.meta.platforms.includes(catalog.platform)) {
      continue;
    }
    const found = runner.run({ parsed, catalog, googleTaxonomy });
    for (const p of found) {
      problems.push(p);
    }
  }

  const grouped = new Map<string, Problem[]>();
  for (const problem of problems) {
    const bucket = grouped.get(problem.ruleId) ?? [];
    bucket.push(problem);
    grouped.set(problem.ruleId, bucket);
  }

  const groups: ProblemGroup[] = [];
  for (const [ruleId, ruleProblems] of grouped.entries()) {
    const meta = metaMap.get(ruleId);
    const first = ruleProblems[0];
    const safeFixCount = ruleProblems.filter((p) => p.fix?.safe).length;
    groups.push({
      ruleId,
      group: meta?.group ?? first.group,
      severity: meta?.severity ?? first.severity,
      title: meta?.title ?? first.title,
      explanation: meta?.explanation ?? first.message,
      count: ruleProblems.length,
      hasSafeFix: safeFixCount > 0,
      safeFixCount,
      example: first,
      problems: ruleProblems,
    });
  }

  groups.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.count - a.count;
  });

  const counts: RuleSummaryCounts = {
    fail: 0,
    reject: 0,
    tip: 0,
    total: problems.length,
    safeFixable: 0,
  };

  for (const p of problems) {
    counts[p.severity]++;
    if (p.fix?.safe) counts.safeFixable++;
  }

  return { problems, groups, counts };
}

/**
 * Runs all rules, lazy-loading the official 2021-09-21 Google Product Taxonomy
 * only when a Google Merchant Center feed is being checked.
 */
export async function runRulesAsync(
  parsed: ParsedCsv,
  catalog: CatalogModel,
  rules: RuleRunner[] = ALL_RULES,
): Promise<RuleEngineResult> {
  const googleTaxonomy = catalog.platform === 'google' ? await loadGoogleTaxonomy() : undefined;
  return runRules(parsed, catalog, { rules, googleTaxonomy });
}

export * from './types';
export { parsePriceValue, normalizeArabicDigits } from './price';
export { computeGs1CheckDigit, isValidGs1CheckDigit, tryRestoreLeadingZero } from './barcode';
export { loadGoogleTaxonomy } from '../platforms/google-taxonomy';
