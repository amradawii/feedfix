import { detectPlatform } from '../core/detect';
import { buildFixPlan } from '../core/fixes';
import { CsvLimitError, parseCsvBytes, ParsedCsv } from '../core/parse';
import { FieldMapping, readCatalog } from '../core/platforms';
import { Platform } from '../core/model';
import { runRulesAsync } from '../core/rules';
import { WorkerRequest, WorkerResponse } from './messages';

async function analyzeParsedCsv(
  id: number,
  fileName: string,
  parsed: ParsedCsv,
  emit: (message: WorkerResponse) => void,
  platformOverride?: Platform,
  otherMapping?: FieldMapping,
): Promise<void> {
  emit({ type: 'progress', id, stage: 'checking', percent: 85, rowsParsed: parsed.rows.length });
  const detection = detectPlatform(parsed.headers);
  const activePlatform = platformOverride ?? detection.platform;
  const catalog = readCatalog(parsed, activePlatform, otherMapping);
  const rules = await runRulesAsync(parsed, catalog);
  const fixPlan = buildFixPlan(rules.problems);

  emit({ type: 'progress', id, stage: 'checking', percent: 100, rowsParsed: parsed.rows.length });
  emit({
    type: 'result',
    id,
    fileName,
    parsed,
    detection,
    activePlatform,
    catalog,
    rules,
    fixPlan,
  });
}

export async function handleWorkerRequest(
  request: WorkerRequest,
  emit: (message: WorkerResponse) => void,
): Promise<void> {
  try {
    if (request.type === 'parse') {
      const bytes = new Uint8Array(request.buffer);
      const parsed = parseCsvBytes(bytes, {
        delimiter: request.delimiter,
        onProgress: (progress) => {
          const scaledPercent =
            progress.stage === 'decoding'
              ? progress.percent
              : Math.min(80, Math.round(10 + (progress.percent / 100) * 70));
          emit({
            type: 'progress',
            id: request.id,
            stage: progress.stage,
            percent: scaledPercent,
            rowsParsed: progress.rowsParsed,
          });
        },
      });

      await analyzeParsedCsv(
        request.id,
        request.fileName,
        parsed,
        emit,
        request.platformOverride,
        request.otherMapping,
      );
      return;
    }

    if (request.type === 'recheck') {
      await analyzeParsedCsv(
        request.id,
        request.fileName,
        request.parsed,
        emit,
        request.platformOverride,
        request.otherMapping,
      );
    }
  } catch (err) {
    if (err instanceof CsvLimitError) {
      emit({
        type: 'error',
        id: request.id,
        code: err.code,
        message: err.message,
      });
      return;
    }

    emit({
      type: 'error',
      id: request.id,
      code: 'PARSE_ERROR',
      message: err instanceof Error ? err.message : 'Could not read this CSV file.',
    });
  }
}
