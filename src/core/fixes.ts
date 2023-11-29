import { ParsedCsv } from './parse';
import { CellEdit, Problem, Severity } from './rules/types';

export type ChangeStatus = 'pending' | 'accepted' | 'rejected';

export interface ProposedChange {
  id: string;
  problemId: string;
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  safe: boolean;
  description: string;
  status: ChangeStatus;
  /** Primary display row/column (first edit) */
  row: number;
  col: number;
  columnName: string;
  before: string;
  after: string;
  /** All cell edits belonging to this change (1 for normal fixes, 2 for price swaps) */
  edits: CellEdit[];
}

export interface FixPlan {
  changes: ProposedChange[];
}

export interface ChangeLogEntry {
  row: number;
  col: number;
  columnName: string;
  before: string;
  after: string;
  ruleId: string;
  ruleTitle: string;
}

export interface ApplyFixesResult {
  parsed: ParsedCsv;
  changeLog: ChangeLogEntry[];
  appliedChangeIds: string[];
  skippedConflicts: number;
}

export interface DiffHighlight {
  prefix: string;
  removed: string;
  added: string;
  suffix: string;
}

const RULE_APPLY_PRIORITY: Record<string, number> = {
  'file.mojibake': 10,
  'file.invisible-chars': 20,
  'price.arabic-digits': 30,
  'price.decimal-comma': 31,
  'price.text-or-currency': 32,
  'barcode.lost-leading-zero': 40,
  'links.spaces-in-url': 50,
  'values.google-availability': 60,
  'values.google-condition': 61,
  'values.google-identifier-exists': 62,
  'values.shopify-status': 63,
  'values.shopify-published': 64,
  'values.shopify-inventory-policy': 65,
  'values.woo-published': 66,
  'values.woo-in-stock': 67,
  'text.whitespace': 70,
  'price.sale-gte-regular': 80,
};

const STRIP_INVISIBLE_CODES = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

function stripInvisible(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (STRIP_INVISIBLE_CODES.has(code)) continue;
    out += code === 0x00a0 ? ' ' : value[i];
  }
  return out;
}

function getRulePriority(ruleId: string): number {
  return RULE_APPLY_PRIORITY[ruleId] ?? 50;
}

/**
 * Builds an immutable FixPlan from detected problems.
 * All proposed changes start as 'pending' so nothing is modified until explicitly accepted.
 */
export function buildFixPlan(problems: Problem[]): FixPlan {
  const changes: ProposedChange[] = [];

  for (const problem of problems) {
    if (!problem.fix || problem.fix.edits.length === 0) continue;
    const primary = problem.fix.edits[0];
    changes.push({
      id: `fix:${problem.id}`,
      problemId: problem.id,
      ruleId: problem.ruleId,
      ruleTitle: problem.title,
      severity: problem.severity,
      safe: problem.fix.safe,
      description: problem.fix.description,
      status: 'pending',
      row: primary.row,
      col: primary.col,
      columnName: primary.columnName,
      before:
        problem.fix.edits.length > 1
          ? problem.fix.edits.map((e) => `${e.columnName}: ${e.before}`).join(' | ')
          : primary.before,
      after:
        problem.fix.edits.length > 1
          ? problem.fix.edits.map((e) => `${e.columnName}: ${e.after}`).join(' | ')
          : primary.after,
      edits: problem.fix.edits.map((e) => ({ ...e })),
    });
  }

  return { changes };
}

/**
 * Accepts only safe fixes (safe === true). Unsafe/opt-in fixes (such as price swaps)
 * are never accepted by this operation.
 */
export function acceptSafeFixes(plan: FixPlan, ruleId?: string): FixPlan {
  return {
    changes: plan.changes.map((change) => {
      if (!change.safe) return change;
      if (ruleId !== undefined && change.ruleId !== ruleId) return change;
      return { ...change, status: 'accepted' };
    }),
  };
}

export function setChangeStatus(plan: FixPlan, changeId: string, status: ChangeStatus): FixPlan {
  return {
    changes: plan.changes.map((change) =>
      change.id === changeId ? { ...change, status } : change,
    ),
  };
}

export function setRuleStatus(plan: FixPlan, ruleId: string, status: ChangeStatus): FixPlan {
  return {
    changes: plan.changes.map((change) =>
      change.ruleId === ruleId ? { ...change, status } : change,
    ),
  };
}

export function countFixStatuses(plan: FixPlan): {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  safeTotal: number;
  safeAccepted: number;
} {
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  let safeTotal = 0;
  let safeAccepted = 0;

  for (const ch of plan.changes) {
    if (ch.safe) safeTotal++;
    if (ch.status === 'accepted') {
      accepted++;
      if (ch.safe) safeAccepted++;
    } else if (ch.status === 'rejected') {
      rejected++;
    } else {
      pending++;
    }
  }

  return {
    total: plan.changes.length,
    accepted,
    rejected,
    pending,
    safeTotal,
    safeAccepted,
  };
}

function getGridCell(
  headers: string[],
  rows: string[][],
  row: number,
  col: number,
): string | undefined {
  if (row === 1) {
    return headers[col];
  }
  const dataRow = rows[row - 2];
  if (!dataRow) return undefined;
  return dataRow[col];
}

function setGridCell(
  headers: string[],
  rows: string[][],
  row: number,
  col: number,
  value: string,
): void {
  if (row === 1) {
    headers[col] = value;
    return;
  }
  const dataRow = rows[row - 2];
  if (dataRow) {
    dataRow[col] = value;
  }
}

/**
 * Applies ONLY accepted changes to a fresh copy of the parsed CSV grid.
 * Guarantees a strict 1-to-1 match between modified cells and the returned changeLog:
 * no cell is ever changed without a corresponding changeLog entry.
 */
export function applyFixes(parsed: ParsedCsv, plan: FixPlan): ApplyFixesResult {
  const nextHeaders = [...parsed.headers];
  const nextRows = parsed.rows.map((r) => [...r]);

  const acceptedChanges = plan.changes
    .filter((ch) => ch.status === 'accepted')
    .sort((a, b) => {
      const pDiff = getRulePriority(a.ruleId) - getRulePriority(b.ruleId);
      if (pDiff !== 0) return pDiff;
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

  // Track original value and applied rule metadata per modified cell key ("row:col")
  const cellAudit = new Map<
    string,
    {
      row: number;
      col: number;
      columnName: string;
      originalBefore: string;
      ruleIds: string[];
      ruleTitles: string[];
    }
  >();

  const appliedChangeIds: string[] = [];
  let skippedConflicts = 0;

  for (const change of acceptedChanges) {
    // Handle atomic multi-cell edits (such as regular/sale price swap)
    if (change.edits.length > 1) {
      // Read live cell values in case an earlier safe price fix normalized formatting first
      const liveValues = change.edits.map((e) => getGridCell(nextHeaders, nextRows, e.row, e.col));
      if (liveValues.some((v) => v === undefined)) {
        skippedConflicts++;
        continue;
      }

      // For a 2-cell swap, swap the current live cell values so earlier safe fixes are preserved
      if (change.ruleId === 'price.sale-gte-regular' && change.edits.length === 2) {
        const [e0, e1] = change.edits;
        const v0 = liveValues[0] as string;
        const v1 = liveValues[1] as string;
        if (v0 === v1) continue;

        const pairs: Array<{ edit: CellEdit; nextVal: string; prevVal: string }> = [
          { edit: e0, nextVal: v1, prevVal: v0 },
          { edit: e1, nextVal: v0, prevVal: v1 },
        ];
        for (const { edit, nextVal, prevVal } of pairs) {
          const key = `${edit.row}:${edit.col}`;
          const existing = cellAudit.get(key);
          if (!existing) {
            cellAudit.set(key, {
              row: edit.row,
              col: edit.col,
              columnName: edit.columnName,
              originalBefore: prevVal,
              ruleIds: [change.ruleId],
              ruleTitles: [change.ruleTitle],
            });
          } else {
            if (!existing.ruleIds.includes(change.ruleId)) existing.ruleIds.push(change.ruleId);
            if (!existing.ruleTitles.includes(change.ruleTitle)) {
              existing.ruleTitles.push(change.ruleTitle);
            }
          }
          setGridCell(nextHeaders, nextRows, edit.row, edit.col, nextVal);
        }
        appliedChangeIds.push(change.id);
        continue;
      }
    }

    let changeApplied = false;

    for (const edit of change.edits) {
      const current = getGridCell(nextHeaders, nextRows, edit.row, edit.col);
      if (current === undefined) {
        skippedConflicts++;
        continue;
      }

      let nextValue: string | null = null;
      if (current === edit.before) {
        nextValue = edit.after;
      } else if (change.ruleId === 'text.whitespace') {
        nextValue = current.trim().replace(/ {2,}/g, ' ');
      } else if (change.ruleId === 'file.invisible-chars') {
        nextValue = stripInvisible(current);
      } else {
        skippedConflicts++;
        continue;
      }

      if (nextValue === current) continue;

      const key = `${edit.row}:${edit.col}`;
      const existing = cellAudit.get(key);
      if (!existing) {
        cellAudit.set(key, {
          row: edit.row,
          col: edit.col,
          columnName: edit.columnName,
          originalBefore: current,
          ruleIds: [change.ruleId],
          ruleTitles: [change.ruleTitle],
        });
      } else {
        if (!existing.ruleIds.includes(change.ruleId)) existing.ruleIds.push(change.ruleId);
        if (!existing.ruleTitles.includes(change.ruleTitle)) {
          existing.ruleTitles.push(change.ruleTitle);
        }
      }

      setGridCell(nextHeaders, nextRows, edit.row, edit.col, nextValue);
      changeApplied = true;
    }

    if (changeApplied) {
      appliedChangeIds.push(change.id);
    }
  }

  // Build final change log strictly from cells whose final value differs from originalBefore
  const changeLog: ChangeLogEntry[] = [];
  for (const audit of cellAudit.values()) {
    const finalVal = getGridCell(nextHeaders, nextRows, audit.row, audit.col);
    if (finalVal === undefined || finalVal === audit.originalBefore) {
      continue;
    }
    changeLog.push({
      row: audit.row,
      col: audit.col,
      columnName: audit.columnName,
      before: audit.originalBefore,
      after: finalVal,
      ruleId: audit.ruleIds.join('; '),
      ruleTitle: audit.ruleTitles.join('; '),
    });
  }

  changeLog.sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  const updatedParsed: ParsedCsv = {
    ...parsed,
    headers: nextHeaders,
    rows: nextRows,
  };

  return {
    parsed: updatedParsed,
    changeLog,
    appliedChangeIds,
    skippedConflicts,
  };
}

/**
 * Computes common-prefix / common-suffix segments for highlighting changed characters
 * in the Review table (before -> after).
 */
export function computeInlineDiff(before: string, after: string): DiffHighlight {
  let prefixLen = 0;
  const minLen = Math.min(before.length, after.length);
  while (prefixLen < minLen && before[prefixLen] === after[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  return {
    prefix: before.slice(0, prefixLen),
    removed: before.slice(prefixLen, before.length - suffixLen),
    added: after.slice(prefixLen, after.length - suffixLen),
    suffix: suffixLen > 0 ? before.slice(before.length - suffixLen) : '',
  };
}
