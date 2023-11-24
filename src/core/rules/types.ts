import { CatalogModel, Platform } from '../model';
import { ParsedCsv } from '../parse';
import { GoogleTaxonomy } from '../platforms/google-taxonomy';

export type Severity = 'fail' | 'reject' | 'tip';

export type RuleGroup =
  | 'file'
  | 'required'
  | 'identity'
  | 'price'
  | 'barcode'
  | 'text'
  | 'links'
  | 'variants'
  | 'values'
  | 'category';

export interface CellEdit {
  /** 1-based spreadsheet row (header = 1, first data row = 2) */
  row: number;
  /** 0-based column index */
  col: number;
  columnName: string;
  before: string;
  after: string;
}

export interface ProposedFix {
  /** True only when the fix cannot change product meaning and qualifies for "Fix all" */
  safe: boolean;
  description: string;
  edits: CellEdit[];
}

export interface Problem {
  id: string;
  ruleId: string;
  group: RuleGroup;
  severity: Severity;
  title: string;
  message: string;
  row: number;
  col?: number;
  columnName?: string;
  rawValue?: string;
  fix?: ProposedFix;
}

export interface RuleMeta {
  id: string;
  group: RuleGroup;
  severity: Severity;
  platforms: Platform[];
  title: string;
  explanation: string;
  hasSafeFix: boolean;
}

export interface RuleContext {
  parsed: ParsedCsv;
  catalog: CatalogModel;
  googleTaxonomy?: GoogleTaxonomy;
}

export interface RuleRunner {
  meta: RuleMeta;
  run: (ctx: RuleContext) => Problem[];
}

export interface ProblemGroup {
  ruleId: string;
  group: RuleGroup;
  severity: Severity;
  title: string;
  explanation: string;
  count: number;
  hasSafeFix: boolean;
  safeFixCount: number;
  example: Problem;
  problems: Problem[];
}

export interface RuleSummaryCounts {
  fail: number;
  reject: number;
  tip: number;
  total: number;
  safeFixable: number;
}

export interface RuleEngineResult {
  problems: Problem[];
  groups: ProblemGroup[];
  counts: RuleSummaryCounts;
}

export const ALL_PLATFORMS: Platform[] = ['shopify', 'woocommerce', 'google', 'other'];

export function createProblemId(
  ruleId: string,
  row: number,
  col?: number,
  suffix?: string | number,
): string {
  const parts = [ruleId, `r${row}`];
  if (col !== undefined) parts.push(`c${col}`);
  if (suffix !== undefined) parts.push(String(suffix));
  return parts.join(':');
}
