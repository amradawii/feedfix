import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acceptSafeFixes,
  applyFixes,
  ChangeStatus,
  FixPlan,
  setChangeStatus,
  setRuleStatus,
} from './core/fixes';
import { Platform } from './core/model';
import { DetectedDelimiter } from './core/parse';
import { FieldMapping, readCatalog } from './core/platforms';
import { suggestColumnMapping } from './core/presets';
import { SampleFeed } from './samples';
import { ColumnMapper } from './ui/ColumnMapper';
import { DetectionBar } from './ui/DetectionBar';
import { DropZone } from './ui/DropZone';
import { DownloadPayload, ExportPanel } from './ui/ExportPanel';
import { ProblemsList } from './ui/ProblemsList';
import { ReviewTable } from './ui/ReviewTable';
import { StepId, Stepper } from './ui/Stepper';
import { WhyNotChatbot } from './ui/WhyNotChatbot';
import { CsvWorkerClient } from './worker/client';
import { AnalysisResultPayload } from './worker/messages';

const STAGE_LABELS: Record<'decoding' | 'parsing' | 'checking', string> = {
  decoding: 'Detecting encoding and decoding file…',
  parsing: 'Reading CSV rows…',
  checking: 'Running platform rules…',
};

interface AppProps {
  onDownloadFile?: (payload: DownloadPayload) => void;
}

export default function App({ onDownloadFile }: AppProps = {}) {
  const workerRef = useRef<CsvWorkerClient | null>(null);
  const rawBufferRef = useRef<ArrayBuffer | null>(null);

  const [step, setStep] = useState<StepId>('upload');
  const [analysis, setAnalysis] = useState<AnalysisResultPayload | null>(null);
  const [otherMapping, setOtherMapping] = useState<FieldMapping>({});
  const [fixPlan, setFixPlan] = useState<FixPlan>({ changes: [] });
  const [reviewRuleFilter, setReviewRuleFilter] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const client = new CsvWorkerClient();
    workerRef.current = client;
    return () => {
      client.terminate();
      workerRef.current = null;
    };
  }, []);

  const runParse = useCallback(
    async (
      buffer: ArrayBuffer,
      fileName: string,
      options: {
        delimiter?: DetectedDelimiter;
        platformOverride?: Platform;
        otherMapping?: FieldMapping;
      } = {},
    ) => {
      if (!workerRef.current) return;
      rawBufferRef.current = buffer.slice(0);
      setIsBusy(true);
      setErrorMessage(null);
      setProgressText('Reading file…');
      setProgressPercent(5);

      try {
        let result = await workerRef.current.parseBuffer(buffer, fileName, {
          delimiter: options.delimiter,
          platformOverride: options.platformOverride,
          otherMapping: options.otherMapping,
          onProgress: (p) => {
            const suffix =
              p.rowsParsed && p.rowsParsed > 0
                ? ` (${p.rowsParsed.toLocaleString('en-US')} rows)`
                : '';
            setProgressText(`${STAGE_LABELS[p.stage]}${suffix}`);
            setProgressPercent(p.percent);
          },
        });

        let appliedMapping = options.otherMapping ?? {};
        if (result.activePlatform === 'other' && Object.keys(appliedMapping).length === 0) {
          appliedMapping = suggestColumnMapping(result.parsed.headers);
          if (Object.keys(appliedMapping).length > 0) {
            result = await workerRef.current.recheck(result.parsed, result.fileName, {
              platformOverride: 'other',
              otherMapping: appliedMapping,
            });
          }
        }

        setOtherMapping(appliedMapping);
        setAnalysis(result);
        setFixPlan(result.fixPlan);
        setReviewRuleFilter(null);
        setStep('problems');
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not read this file.');
      } finally {
        setIsBusy(false);
        setProgressText(null);
        setProgressPercent(0);
      }
    },
    [],
  );

  const handleFileSelected = useCallback(
    (file: File) => {
      void file.arrayBuffer().then((buf) => runParse(buf, file.name));
    },
    [runParse],
  );

  const handleSampleSelected = useCallback(
    (sample: SampleFeed) => {
      const encoded = new TextEncoder().encode(sample.content);
      const copy = encoded.buffer.slice(
        encoded.byteOffset,
        encoded.byteOffset + encoded.byteLength,
      );
      void runParse(copy, sample.fileName);
    },
    [runParse],
  );

  const handlePlatformChange = useCallback(
    async (nextPlatform: Platform) => {
      if (!analysis || !workerRef.current) return;
      setIsBusy(true);
      setErrorMessage(null);
      try {
        const mappingForOther =
          nextPlatform === 'other'
            ? Object.keys(otherMapping).length > 0
              ? otherMapping
              : suggestColumnMapping(analysis.parsed.headers)
            : undefined;
        if (mappingForOther) {
          setOtherMapping(mappingForOther);
        }
        const result = await workerRef.current.recheck(analysis.parsed, analysis.fileName, {
          platformOverride: nextPlatform,
          otherMapping: mappingForOther,
        });
        setAnalysis(result);
        setFixPlan(result.fixPlan);
        setReviewRuleFilter(null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not switch format.');
      } finally {
        setIsBusy(false);
      }
    },
    [analysis, otherMapping],
  );

  const handleApplyOtherMapping = useCallback(
    async (nextMapping: FieldMapping) => {
      if (!analysis || !workerRef.current) return;
      setOtherMapping(nextMapping);
      setIsBusy(true);
      setErrorMessage(null);
      try {
        const result = await workerRef.current.recheck(analysis.parsed, analysis.fileName, {
          platformOverride: 'other',
          otherMapping: nextMapping,
        });
        setAnalysis(result);
        setFixPlan(result.fixPlan);
        setReviewRuleFilter(null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not apply mapping.');
      } finally {
        setIsBusy(false);
      }
    },
    [analysis],
  );

  const handleDelimiterChange = useCallback(
    (nextDelimiter: DetectedDelimiter) => {
      if (!analysis || !rawBufferRef.current) return;
      void runParse(rawBufferRef.current.slice(0), analysis.fileName, {
        delimiter: nextDelimiter,
        platformOverride: analysis.activePlatform,
        otherMapping: analysis.activePlatform === 'other' ? otherMapping : undefined,
      });
    },
    [analysis, otherMapping, runParse],
  );

  const handleReset = useCallback(() => {
    rawBufferRef.current = null;
    setAnalysis(null);
    setOtherMapping({});
    setFixPlan({ changes: [] });
    setReviewRuleFilter(null);
    setErrorMessage(null);
    setStep('upload');
  }, []);

  const handleFixAllSafe = useCallback(() => {
    setFixPlan((prev) => acceptSafeFixes(prev));
  }, []);

  const handleFixRuleSafe = useCallback((ruleId: string) => {
    setFixPlan((prev) => acceptSafeFixes(prev, ruleId));
  }, []);

  const handleInspectRule = useCallback((ruleId: string) => {
    setReviewRuleFilter(ruleId);
    setStep('review');
  }, []);

  const handleSetChangeStatus = useCallback((changeId: string, status: ChangeStatus) => {
    setFixPlan((prev) => setChangeStatus(prev, changeId, status));
  }, []);

  const handleSetRuleStatus = useCallback((ruleId: string, status: ChangeStatus) => {
    setFixPlan((prev) => setRuleStatus(prev, ruleId, status));
  }, []);

  const handleRejectAll = useCallback(() => {
    setFixPlan((prev) => ({
      changes: prev.changes.map((c) => ({ ...c, status: 'rejected' })),
    }));
  }, []);

  const exportState = useMemo(() => {
    if (!analysis || step !== 'export') return null;
    const applied = applyFixes(analysis.parsed, fixPlan);
    const catalog =
      applied.changeLog.length > 0
        ? readCatalog(
            applied.parsed,
            analysis.activePlatform,
            analysis.activePlatform === 'other' ? otherMapping : undefined,
          )
        : analysis.catalog;
    return {
      parsed: applied.parsed,
      catalog,
      changeLog: applied.changeLog,
    };
  }, [analysis, fixPlan, otherMapping, step]);

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="text-lg font-semibold tracking-tight text-neutral-900">FeedFix</h1>
            <p className="text-sm text-neutral-500">
              Clean and convert product CSV files in your browser.
            </p>
          </div>
          <Stepper currentStep={step} hasFile={Boolean(analysis)} onSelectStep={setStep} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        {analysis && (
          <div className="mb-6">
            <DetectionBar
              fileName={analysis.fileName}
              platform={analysis.activePlatform}
              rowCount={analysis.parsed.rows.length}
              productCount={analysis.catalog.products.length}
              encodingLabel={analysis.parsed.encodingLabel}
              delimiter={analysis.parsed.delimiter}
              delimiterLabel={analysis.parsed.delimiterLabel}
              isBusy={isBusy}
              onPlatformChange={(p) => void handlePlatformChange(p)}
              onDelimiterChange={handleDelimiterChange}
              onReset={handleReset}
            />
          </div>
        )}

        {step === 'upload' && (
          <DropZone
            isBusy={isBusy}
            progressText={progressText}
            progressPercent={progressPercent}
            errorMessage={errorMessage}
            onFileSelected={handleFileSelected}
            onSampleSelected={handleSampleSelected}
          />
        )}

        {step === 'problems' && analysis && (
          <>
            {analysis.activePlatform === 'other' && (
              <ColumnMapper
                headers={analysis.parsed.headers}
                sampleRow={analysis.parsed.rows[0] ?? []}
                mapping={otherMapping}
                isBusy={isBusy}
                onApplyMapping={(m) => void handleApplyOtherMapping(m)}
              />
            )}
            <ProblemsList
              groups={analysis.rules.groups}
              counts={analysis.rules.counts}
              fixPlan={fixPlan}
              onFixAllSafe={handleFixAllSafe}
              onFixRuleSafe={handleFixRuleSafe}
              onInspectRule={handleInspectRule}
              onGoToReview={() => setStep('review')}
              onGoToExport={() => setStep('export')}
            />
          </>
        )}

        {step === 'review' && analysis && (
          <ReviewTable
            fixPlan={fixPlan}
            selectedRuleId={reviewRuleFilter}
            onSelectRuleFilter={setReviewRuleFilter}
            onSetChangeStatus={handleSetChangeStatus}
            onSetRuleStatus={handleSetRuleStatus}
            onAcceptAllSafe={handleFixAllSafe}
            onRejectAll={handleRejectAll}
            onGoToExport={() => setStep('export')}
          />
        )}

        {step === 'export' && analysis && exportState && (
          <ExportPanel
            fileName={analysis.fileName}
            parsed={exportState.parsed}
            catalog={exportState.catalog}
            sourceCatalog={analysis.catalog}
            changeLog={exportState.changeLog}
            onDownloadFile={onDownloadFile}
          />
        )}

        <WhyNotChatbot />
      </main>
    </div>
  );
}
