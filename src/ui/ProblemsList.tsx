import { useState } from 'react';
import { countFixStatuses, FixPlan } from '../core/fixes';
import { ProblemGroup, RuleSummaryCounts, Severity } from '../core/rules';

interface ProblemsListProps {
  groups: ProblemGroup[];
  counts: RuleSummaryCounts;
  fixPlan: FixPlan;
  onFixAllSafe: () => void;
  onFixRuleSafe: (ruleId: string) => void;
  onInspectRule: (ruleId: string) => void;
  onGoToReview: () => void;
  onGoToExport: () => void;
}

const SEVERITY_META: Record<Severity, { label: string; dotClass: string; textClass: string }> = {
  fail: {
    label: 'Will fail',
    dotClass: 'bg-red-600',
    textClass: 'text-red-700',
  },
  reject: {
    label: 'May be rejected',
    dotClass: 'bg-amber-600',
    textClass: 'text-amber-800',
  },
  tip: {
    label: 'Tip',
    dotClass: 'bg-neutral-500',
    textClass: 'text-neutral-600',
  },
};

function formatExampleValue(raw: string | undefined): string {
  if (!raw) return '';
  const single = raw.replace(/\s+/g, ' ').trim();
  return single.length > 42 ? `${single.slice(0, 42)}…` : single;
}

export function ProblemsList({
  groups,
  counts,
  fixPlan,
  onFixAllSafe,
  onFixRuleSafe,
  onInspectRule,
  onGoToReview,
  onGoToExport,
}: ProblemsListProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);

  const fixCounts = countFixStatuses(fixPlan);
  const filteredGroups =
    severityFilter === 'all' ? groups : groups.filter((g) => g.severity === severityFilter);

  const acceptedCountByRule = new Map<string, number>();
  const fixableCountByRule = new Map<string, number>();
  for (const ch of fixPlan.changes) {
    fixableCountByRule.set(ch.ruleId, (fixableCountByRule.get(ch.ruleId) ?? 0) + 1);
    if (ch.status === 'accepted') {
      acceptedCountByRule.set(ch.ruleId, (acceptedCountByRule.get(ch.ruleId) ?? 0) + 1);
    }
  }

  return (
    <section aria-labelledby="problems-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="problems-heading" className="text-base font-semibold text-neutral-900">
            Problems found
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-red-700">
              <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
              {counts.fail.toLocaleString('en-US')} will fail
            </span>
            <span className="text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span className="inline-flex items-center gap-1.5 text-amber-800">
              <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" />
              {counts.reject.toLocaleString('en-US')} may be rejected
            </span>
            <span className="text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span className="inline-flex items-center gap-1.5 text-neutral-600">
              <span className="h-2 w-2 rounded-full bg-neutral-500" aria-hidden="true" />
              {counts.tip.toLocaleString('en-US')} {counts.tip === 1 ? 'tip' : 'tips'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {fixCounts.safeTotal > 0 && (
            <button
              type="button"
              onClick={onFixAllSafe}
              disabled={fixCounts.safeAccepted === fixCounts.safeTotal}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {fixCounts.safeAccepted === fixCounts.safeTotal
                ? `All ${fixCounts.safeTotal.toLocaleString('en-US')} safe fixes queued`
                : `Fix all safe (${fixCounts.safeTotal.toLocaleString('en-US')})`}
            </button>
          )}
          {fixCounts.total > 0 ? (
            <button
              type="button"
              onClick={onGoToReview}
              className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              Review changes ({fixCounts.accepted.toLocaleString('en-US')}/
              {fixCounts.total.toLocaleString('en-US')})
            </button>
          ) : (
            <button
              type="button"
              onClick={onGoToExport}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              Continue to export
            </button>
          )}
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 pb-3"
        role="group"
        aria-label="Filter by severity"
      >
        {(
          [
            { id: 'all', label: `All (${counts.total.toLocaleString('en-US')})` },
            { id: 'fail', label: `Will fail (${counts.fail.toLocaleString('en-US')})` },
            { id: 'reject', label: `May be rejected (${counts.reject.toLocaleString('en-US')})` },
            { id: 'tip', label: `Tips (${counts.tip.toLocaleString('en-US')})` },
          ] as const
        ).map((tab) => {
          const active = severityFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSeverityFilter(tab.id)}
              className={[
                'rounded-lg border px-3 py-1 text-xs font-medium tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
                active
                  ? 'border-accent text-accent bg-blue-50/40'
                  : 'border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:text-neutral-900',
              ].join(' ')}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {filteredGroups.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 px-5 py-8 text-center text-sm text-neutral-600">
          {counts.total === 0
            ? 'No problems found. This file looks clean and ready to export.'
            : 'No problems match this severity filter.'}
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {filteredGroups.map((group) => {
            const sev = SEVERITY_META[group.severity];
            const acceptedForRule = acceptedCountByRule.get(group.ruleId) ?? 0;
            const totalFixableForRule = fixableCountByRule.get(group.ruleId) ?? 0;
            const allSafeAccepted = group.hasSafeFix && acceptedForRule >= group.safeFixCount;
            const isExpanded = expandedRuleId === group.ruleId;
            const examplePreview = formatExampleValue(group.example.rawValue);

            return (
              <li key={group.ruleId} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${sev.textClass}`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${sev.dotClass}`}
                          aria-hidden="true"
                        />
                        <span className="sr-only">{sev.label}:</span>
                      </span>
                      <span className="font-medium text-neutral-900">{group.title}</span>
                      <span className="text-neutral-300" aria-hidden="true">
                        &middot;
                      </span>
                      <span className="tabular-nums text-neutral-600">
                        {group.count.toLocaleString('en-US')} {group.count === 1 ? 'row' : 'rows'}
                      </span>
                      <span className="text-neutral-300" aria-hidden="true">
                        &middot;
                      </span>
                      <span className="text-xs text-neutral-600">
                        e.g. row <span className="tabular-nums">{group.example.row}</span>
                        {examplePreview ? (
                          <>
                            : <code className="font-mono text-neutral-800">{examplePreview}</code>
                          </>
                        ) : (
                          <>: {group.example.message}</>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500">{group.explanation}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {group.hasSafeFix && (
                      <button
                        type="button"
                        onClick={() => onFixRuleSafe(group.ruleId)}
                        disabled={allSafeAccepted}
                        className="rounded-lg border border-accent px-2.5 py-1 text-xs font-medium text-accent hover:bg-blue-50/50 disabled:cursor-default disabled:border-neutral-200 disabled:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-accent/30"
                      >
                        {allSafeAccepted ? 'Queued' : 'Fix all'}
                      </button>
                    )}

                    {totalFixableForRule > 0 ? (
                      <button
                        type="button"
                        onClick={() => onInspectRule(group.ruleId)}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                      >
                        Review rows
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setExpandedRuleId(isExpanded ? null : group.ruleId)}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                      >
                        {isExpanded ? 'Hide rows' : 'Show rows'}
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/70 p-3">
                    <ul className="space-y-1.5 text-xs text-neutral-700">
                      {group.problems.slice(0, 15).map((p) => (
                        <li key={p.id} className="flex flex-wrap gap-x-2">
                          <span className="font-medium tabular-nums text-neutral-900">
                            Row {p.row}
                          </span>
                          {p.columnName && (
                            <span className="font-mono text-neutral-500">{p.columnName}</span>
                          )}
                          <span>{p.message}</span>
                        </li>
                      ))}
                    </ul>
                    {group.problems.length > 15 && (
                      <p className="mt-2 text-xs text-neutral-500">
                        Showing 15 of {group.problems.length.toLocaleString('en-US')} affected rows.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
