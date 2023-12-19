import { describe, expect, it } from 'vitest';
import {
  acceptSafeFixes,
  applyFixes,
  buildFixPlan,
  computeInlineDiff,
  countFixStatuses,
  setChangeStatus,
  setRuleStatus,
} from '../src/core/fixes';
import { parseCsvBytes } from '../src/core/parse';
import { readCatalog } from '../src/core/platforms';
import { runRules } from '../src/core/rules';
import { SAMPLE_FEEDS } from '../src/samples';

function analyze(csv: string) {
  const parsed = parseCsvBytes(new TextEncoder().encode(csv));
  const catalog = readCatalog(parsed);
  const rules = runRules(parsed, catalog);
  return { parsed, catalog, rules };
}

describe('fix proposal, review state, and change log', () => {
  it('never alters unsafe values (scientific barcodes, ???, swaps, http://) on acceptSafeFixes', () => {
    const shopify = SAMPLE_FEEDS.find((s) => s.id === 'shopify')!;
    const { parsed, rules } = analyze(shopify.content);

    const initialPlan = buildFixPlan(rules.problems);
    expect(countFixStatuses(initialPlan).accepted).toBe(0);

    // Accepting all safe fixes must leave unsafe fixes (sale >= regular swap) pending
    const safePlan = acceptSafeFixes(initialPlan);
    const swapChange = safePlan.changes.find((c) => c.ruleId === 'price.sale-gte-regular');
    expect(swapChange).toBeDefined();
    expect(swapChange?.safe).toBe(false);
    expect(swapChange?.status).toBe('pending');

    const applied = applyFixes(parsed, safePlan);

    // Original parsed CSV must remain untouched (immutability)
    expect(parsed.rows[0][18]).toBe('1,200 EGP');

    // Safe fixes applied:
    // - Row 2 price "1,200 EGP" -> "1200.00"
    expect(applied.parsed.rows[0][18]).toBe('1200.00');
    // - Row 3 lost leading-zero UPC "36000291452" -> "036000291452"
    expect(applied.parsed.rows[1][20]).toBe('036000291452');
    // - Row 6 Arabic mojibake repaired & Arabic-Indic price "٨٥٠" -> "850.00"
    expect(applied.parsed.rows[4][1]).toBe('القميص الكتان');
    expect(applied.parsed.rows[4][18]).toBe('850.00');
    // - Row 7 spaces in URL encoded, while http:// is preserved (never rewritten to https://)
    expect(applied.parsed.rows[5][21]).toBe('http://example.com/images/pour%20over.jpg');
    expect(applied.parsed.rows[5][24]).toBe('active');

    // Unsafe/unrecoverable values MUST remain unchanged:
    // - Row 4 swapped prices NOT swapped by acceptSafeFixes
    expect(applied.parsed.rows[2][18]).toBe('1500.00');
    expect(applied.parsed.rows[2][19]).toBe('1200.00');
    // - Row 6 scientific-notation barcode untouched
    expect(applied.parsed.rows[4][20]).toBe('6.29E+12');
    // - Row 8 invalid check-digit barcode untouched
    expect(applied.parsed.rows[6][20]).toBe('4006381333939');
  });

  it('guarantees an exact 1-to-1 match between modified cells and the change log', () => {
    const shopify = SAMPLE_FEEDS.find((s) => s.id === 'shopify')!;
    const { parsed, rules } = analyze(shopify.content);

    let plan = acceptSafeFixes(buildFixPlan(rules.problems));
    // Also explicitly opt in to accepting the price swap
    const swap = plan.changes.find((c) => c.ruleId === 'price.sale-gte-regular')!;
    plan = setChangeStatus(plan, swap.id, 'accepted');

    const applied = applyFixes(parsed, plan);

    // Diff every single cell between original grid and applied grid
    const actualDiffs: Array<{ row: number; col: number; before: string; after: string }> = [];
    for (let c = 0; c < parsed.headers.length; c++) {
      if (parsed.headers[c] !== applied.parsed.headers[c]) {
        actualDiffs.push({
          row: 1,
          col: c,
          before: parsed.headers[c],
          after: applied.parsed.headers[c],
        });
      }
    }
    for (let r = 0; r < parsed.rows.length; r++) {
      for (let c = 0; c < parsed.rows[r].length; c++) {
        if (parsed.rows[r][c] !== applied.parsed.rows[r][c]) {
          actualDiffs.push({
            row: r + 2,
            col: c,
            before: parsed.rows[r][c],
            after: applied.parsed.rows[r][c],
          });
        }
      }
    }

    expect(applied.changeLog).toHaveLength(actualDiffs.length);
    for (let i = 0; i < actualDiffs.length; i++) {
      expect(applied.changeLog[i].row).toBe(actualDiffs[i].row);
      expect(applied.changeLog[i].col).toBe(actualDiffs[i].col);
      expect(applied.changeLog[i].before).toBe(actualDiffs[i].before);
      expect(applied.changeLog[i].after).toBe(actualDiffs[i].after);
    }

    // Confirm row 4 prices actually swapped after explicit opt-in
    expect(applied.parsed.rows[2][18]).toBe('1200.00');
    expect(applied.parsed.rows[2][19]).toBe('1500.00');
  });

  it('supports per-rule and per-change accept/reject toggles', () => {
    const csv = [
      'Handle,Title,Variant Price,Variant Barcode,Status',
      'a-1,Shirt One,"1,200 EGP",36000291452,Active',
      'a-2,Shirt Two,"2,500 EGP",1234565,Draft',
    ].join('\n');
    const { parsed, rules } = analyze(csv);

    let plan = acceptSafeFixes(buildFixPlan(rules.problems));
    // Reject all barcode fixes
    plan = setRuleStatus(plan, 'barcode.lost-leading-zero', 'rejected');
    // Reject just row 3's price fix
    const row3Price = plan.changes.find(
      (c) => c.ruleId === 'price.text-or-currency' && c.row === 3,
    )!;
    plan = setChangeStatus(plan, row3Price.id, 'rejected');

    const applied = applyFixes(parsed, plan);
    expect(applied.parsed.rows[0][2]).toBe('1200.00'); // accepted
    expect(applied.parsed.rows[1][2]).toBe('2,500 EGP'); // rejected per change
    expect(applied.parsed.rows[0][3]).toBe('36000291452'); // rejected per rule
    expect(applied.parsed.rows[1][3]).toBe('1234565'); // rejected per rule
    expect(applied.parsed.rows[0][4]).toBe('active'); // accepted
    expect(applied.parsed.rows[1][4]).toBe('draft'); // accepted
  });

  it('chains overlapping safe fixes on the same cell (e.g. invisible chars + whitespace) cleanly', () => {
    const csv = `Handle,Title,Variant Price\na-1,  Cotton\u200B  Shirt\u00A0Blue  ,25.00`;
    const { parsed, rules } = analyze(csv);
    const plan = acceptSafeFixes(buildFixPlan(rules.problems));
    const applied = applyFixes(parsed, plan);

    expect(applied.parsed.rows[0][1]).toBe('Cotton Shirt Blue');
    expect(applied.changeLog).toHaveLength(1);
    expect(applied.changeLog[0].before).toBe(`  Cotton\u200B  Shirt\u00A0Blue  `);
    expect(applied.changeLog[0].after).toBe('Cotton Shirt Blue');
  });

  it('computes inline diff highlights accurately', () => {
    expect(computeInlineDiff('36000291452', '036000291452')).toEqual({
      prefix: '',
      removed: '',
      added: '0',
      suffix: '36000291452',
    });

    expect(
      computeInlineDiff('https://example.com/my image.jpg', 'https://example.com/my%20image.jpg'),
    ).toEqual({
      prefix: 'https://example.com/my',
      removed: ' ',
      added: '%20',
      suffix: 'image.jpg',
    });
  });
});
