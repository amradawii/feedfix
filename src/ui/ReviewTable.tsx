import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChangeStatus,
  computeInlineDiff,
  countFixStatuses,
  FixPlan,
  ProposedChange,
} from '../core/fixes';
import { Severity } from '../core/rules';

interface ReviewTableProps {
  fixPlan: FixPlan;
  selectedRuleId: string | null;
  onSelectRuleFilter: (ruleId: string | null) => void;
  onSetChangeStatus: (changeId: string, status: ChangeStatus) => void;
  onSetRuleStatus: (ruleId: string, status: ChangeStatus) => void;
  onAcceptAllSafe: () => void;
  onRejectAll: () => void;
  onGoToExport: () => void;
}

const ROW_HEIGHT = 52;
const VIEWPORT_HEIGHT = 468;
const OVERSCAN = 8;

const SEVERITY_DOT: Record<Severity, string> = {
  fail: 'bg-red-600',
  reject: 'bg-amber-600',
  tip: 'bg-neutral-500',
};

function DiffCell({ before, after }: { before: string; after: string }) {
  const diff = computeInlineDiff(before, after);
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-xs leading-snug">
      <span className="max-w-[210px] truncate text-neutral-700" title={before}>
        <span>{diff.prefix}</span>
        {diff.removed && (
          <span className="rounded-sm bg-red-50 px-0.5 text-red-700 line-through">
            {diff.removed}
          </span>
        )}
        <span>{diff.suffix}</span>
      </span>
      <span className="text-neutral-400 select-none" aria-hidden="true">
        &rarr;
      </span>
      <span className="max-w-[210px] truncate text-neutral-900" title={after}>
        <span>{diff.prefix}</span>
        {diff.added && (
          <span className="rounded-sm bg-blue-50 px-0.5 font-medium text-accent">{diff.added}</span>
        )}
        <span>{diff.suffix}</span>
      </span>
    </div>
  );
}

export function ReviewTable({
  fixPlan,
  selectedRuleId,
  onSelectRuleFilter,
  onSetChangeStatus,
  onSetRuleStatus,
  onAcceptAllSafe,
  onRejectAll,
  onGoToExport,
}: ReviewTableProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | ChangeStatus>('all');
  const [scrollTop, setScrollTop] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const ruleOptions = useMemo(() => {
    const map = new Map<string, { ruleId: string; title: string; count: number }>();
    for (const ch of fixPlan.changes) {
      const existing = map.get(ch.ruleId);
      if (existing) {
        existing.count++;
      } else {
        map.set(ch.ruleId, { ruleId: ch.ruleId, title: ch.ruleTitle, count: 1 });
      }
    }
    return [...map.values()];
  }, [fixPlan.changes]);

  const visibleChanges = useMemo(() => {
    return fixPlan.changes.filter((ch) => {
      if (selectedRuleId && ch.ruleId !== selectedRuleId) return false;
      if (statusFilter !== 'all' && ch.status !== statusFilter) return false;
      return true;
    });
  }, [fixPlan.changes, selectedRuleId, statusFilter]);

  useEffect(() => {
    setScrollTop(0);
    setFocusedIndex(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [selectedRuleId, statusFilter]);

  const counts = countFixStatuses(fixPlan);

  const totalCount = visibleChanges.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRowCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(totalCount, startIndex + visibleRowCount);

  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT);
  const slice: ProposedChange[] = visibleChanges.slice(startIndex, endIndex);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (totalCount === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(totalCount - 1, focusedIndex + 1);
      setFocusedIndex(next);
      ensureRowVisible(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(0, focusedIndex - 1);
      setFocusedIndex(prev);
      ensureRowVisible(prev);
    } else if (event.key === 'a' || event.key === 'A') {
      const target = visibleChanges[focusedIndex];
      if (target) {
        event.preventDefault();
        onSetChangeStatus(target.id, 'accepted');
      }
    } else if (event.key === 'r' || event.key === 'R') {
      const target = visibleChanges[focusedIndex];
      if (target) {
        event.preventDefault();
        onSetChangeStatus(target.id, 'rejected');
      }
    }
  };

  const ensureRowVisible = (index: number) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const rowTop = index * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + VIEWPORT_HEIGHT - 40;
    if (rowTop < viewTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > viewBottom) {
      el.scrollTop = rowBottom - VIEWPORT_HEIGHT + 40;
    }
  };

  return (
    <section aria-labelledby="review-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="review-heading" className="text-base font-semibold text-neutral-900">
            Review changes
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600 tabular-nums">
            <span className="font-medium text-neutral-900">
              {counts.accepted.toLocaleString('en-US')} accepted
            </span>
            <span className="mx-1.5 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>{counts.pending.toLocaleString('en-US')} pending</span>
            <span className="mx-1.5 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>{counts.rejected.toLocaleString('en-US')} rejected</span>
            <span className="mx-1.5 text-neutral-300" aria-hidden="true">
              &middot;
            </span>
            <span>{counts.total.toLocaleString('en-US')} total</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {counts.safeTotal > 0 && (
            <button
              type="button"
              onClick={onAcceptAllSafe}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              Accept all safe ({counts.safeTotal.toLocaleString('en-US')})
            </button>
          )}
          {counts.total > 0 && (
            <button
              type="button"
              onClick={onRejectAll}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              Reject all
            </button>
          )}
          <button
            type="button"
            onClick={onGoToExport}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-medium text-white hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            Continue to export
          </button>
        </div>
      </div>

      {fixPlan.changes.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 px-5 py-8 text-center text-sm text-neutral-600">
          No proposed changes for this file. Continue to export when ready.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                <span>Rule</span>
                <select
                  aria-label="Filter changes by rule"
                  value={selectedRuleId ?? ''}
                  onChange={(e) => onSelectRuleFilter(e.target.value || null)}
                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">
                    All rules ({fixPlan.changes.length.toLocaleString('en-US')})
                  </option>
                  {ruleOptions.map((opt) => (
                    <option key={opt.ruleId} value={opt.ruleId}>
                      {opt.title} ({opt.count.toLocaleString('en-US')})
                    </option>
                  ))}
                </select>
              </label>

              {selectedRuleId && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onSetRuleStatus(selectedRuleId, 'accepted')}
                    className="rounded-lg border border-accent px-2.5 py-1 text-xs font-medium text-accent hover:bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    Accept rule
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetRuleStatus(selectedRuleId, 'rejected')}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    Reject rule
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectRuleFilter(null)}
                    className="px-1.5 text-xs text-accent hover:underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1" role="group" aria-label="Filter by status">
              {(['all', 'accepted', 'pending', 'rejected'] as const).map((status) => {
                const active = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(status)}
                    className={[
                      'rounded-lg border px-2.5 py-1 text-xs capitalize transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
                      active
                        ? 'border-accent bg-blue-50/40 font-medium text-accent'
                        : 'border-neutral-200 text-neutral-600 hover:border-neutral-300',
                    ].join(' ')}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            ref={scrollContainerRef}
            tabIndex={0}
            role="region"
            aria-label="Proposed changes table"
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            style={{ maxHeight: `${VIEWPORT_HEIGHT}px` }}
            className="overflow-auto rounded-lg border border-neutral-200 bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600">
                <tr>
                  <th scope="col" className="w-20 px-3 py-2.5">
                    Row
                  </th>
                  <th scope="col" className="w-44 px-3 py-2.5">
                    Column
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Before &rarr; After
                  </th>
                  <th scope="col" className="w-60 px-3 py-2.5">
                    Rule
                  </th>
                  <th scope="col" className="w-40 px-3 py-2.5 text-right">
                    Decision
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {topSpacerHeight > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={5} style={{ height: `${topSpacerHeight}px`, padding: 0 }} />
                  </tr>
                )}
                {slice.map((change, idx) => {
                  const absoluteIdx = startIndex + idx;
                  const isFocused = absoluteIdx === focusedIndex;
                  return (
                    <tr
                      key={change.id}
                      onClick={() => setFocusedIndex(absoluteIdx)}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      className={[
                        'transition-colors',
                        isFocused ? 'bg-blue-50/30' : 'hover:bg-neutral-50/60',
                      ].join(' ')}
                    >
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-neutral-600">
                        {change.row}
                      </td>
                      <td
                        className="max-w-[176px] truncate px-3 py-2 font-mono text-xs text-neutral-700"
                        title={change.columnName}
                      >
                        {change.columnName}
                      </td>
                      <td className="px-3 py-2">
                        <DiffCell before={change.before} after={change.after} />
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-700">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              SEVERITY_DOT[change.severity]
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate" title={change.ruleTitle}>
                            {change.ruleTitle}
                          </span>
                        </span>
                        {!change.safe && <span className="ml-1.5 text-amber-800">(review)</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            aria-pressed={change.status === 'accepted'}
                            aria-label={`Accept change on row ${change.row} ${change.columnName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSetChangeStatus(change.id, 'accepted');
                            }}
                            className={[
                              'rounded border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
                              change.status === 'accepted'
                                ? 'border-accent bg-accent text-white'
                                : 'border-neutral-200 bg-white text-neutral-700 hover:border-accent hover:text-accent',
                            ].join(' ')}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            aria-pressed={change.status === 'rejected'}
                            aria-label={`Reject change on row ${change.row} ${change.columnName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSetChangeStatus(change.id, 'rejected');
                            }}
                            className={[
                              'rounded border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30',
                              change.status === 'rejected'
                                ? 'border-red-600 text-red-700 bg-red-50/50'
                                : 'border-neutral-200 bg-white text-neutral-600 hover:border-red-300 hover:text-red-700',
                            ].join(' ')}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {bottomSpacerHeight > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={5} style={{ height: `${bottomSpacerHeight}px`, padding: 0 }} />
                  </tr>
                )}
                {visibleChanges.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-500">
                      No changes match the current filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-500">
            Showing {visibleChanges.length.toLocaleString('en-US')} changes. Keyboard shortcuts when
            table is focused: Up/Down arrows move rows, A accepts, R rejects.
          </p>
        </>
      )}
    </section>
  );
}
