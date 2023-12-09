import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptSafeFixes, FixPlan } from './core/fixes';
import { Platform } from './core/model';
import { DetectedDelimiter } from './core/parse';
import { SampleFeed } from './samples';
import { DetectionBar } from './ui/DetectionBar';
import { DropZone } from './ui/DropZone';
import { ProblemsList } from './ui/ProblemsList';
import { StepId, Stepper } from './ui/Stepper';
import { WhyNotChatbot } from './ui/WhyNotChatbot';
import { CsvWorkerClient } from './worker/client';
import { AnalysisResultPayload } from './worker/messages';

const STAGE_LABELS: Record<'decoding' | 'parsing' | 'checking', string> = {
  decoding: 'Detecting encoding and decoding file…',
  parsing: 'Reading CSV rows…',
  checking: 'Running platform rules…',
};

export default function App() {
  const workerRef = useRef<CsvWorkerClient | null>(null);
  const rawBufferRef = useRef<ArrayBuffer | null>(null);

  const [step, setStep] = useState<StepId>('upload');
  const [analysis, setAnalysis] = useState<AnalysisResultPayload | null>(null);
  const [fixPlan, setFixPlan] = useState<FixPlan>({ changes: [] });
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
      options: { delimiter?: DetectedDelimiter; platformOverride?: Platform } = {},
    ) => {
      if (!workerRef.current) return;
      // Retain a copy so delimiter overrides can re-parse cleanly without re-uploading.
      rawBufferRef.current = buffer.slice(0);
      setIsBusy(true);
      setErrorMessage(null);
      setProgressText('Reading file…');
      setProgressPercent(5);

      try {
        const result = await workerRef.current.parseBuffer(buffer, fileName, {
          delimiter: options.delimiter,
          platformOverride: options.platformOverride,
          onProgress: (p) => {
            const suffix =
              p.rowsParsed && p.rowsParsed > 0
                ? ` (${p.rowsParsed.toLocaleString('en-US')} rows)`
                : '';
            setProgressText(`${STAGE_LABELS[p.stage]}${suffix}`);
            setProgressPercent(p.percent);
          },
        });
        setAnalysis(result);
        setFixPlan(result.fixPlan);
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
        const result = await workerRef.current.recheck(analysis.parsed, analysis.fileName, {
          platformOverride: nextPlatform,
        });
        setAnalysis(result);
        setFixPlan(result.fixPlan);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not switch format.');
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
      });
    },
    [analysis, runParse],
  );

  const handleReset = useCallback(() => {
    rawBufferRef.current = null;
    setAnalysis(null);
    setFixPlan({ changes: [] });
    setErrorMessage(null);
    setStep('upload');
  }, []);

  const handleFixAllSafe = useCallback(() => {
    setFixPlan((prev) => acceptSafeFixes(prev));
  }, []);

  const handleFixRuleSafe = useCallback((ruleId: string) => {
    setFixPlan((prev) => acceptSafeFixes(prev, ruleId));
  }, []);

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
          <ProblemsList
            groups={analysis.rules.groups}
            counts={analysis.rules.counts}
            fixPlan={fixPlan}
            onFixAllSafe={handleFixAllSafe}
            onFixRuleSafe={handleFixRuleSafe}
            onInspectRule={() => setStep('review')}
            onGoToReview={() => setStep('review')}
            onGoToExport={() => setStep('export')}
          />
        )}

        {step === 'review' && analysis && (
          <section className="rounded-lg border border-neutral-200 p-6 text-sm text-neutral-600">
            <p>
              {fixPlan.changes.filter((c) => c.status === 'accepted').length} of{' '}
              {fixPlan.changes.length} proposed changes are queued for review.
            </p>
          </section>
        )}

        {step === 'export' && analysis && (
          <section className="rounded-lg border border-neutral-200 p-6 text-sm text-neutral-600">
            <p>Ready to export {analysis.fileName}.</p>
          </section>
        )}

        <WhyNotChatbot />
      </main>
    </div>
  );
}
