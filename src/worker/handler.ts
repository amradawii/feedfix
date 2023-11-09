import { CsvLimitError, parseCsvBytes } from '../core/parse';
import { WorkerRequest, WorkerResponse } from './messages';

export function handleWorkerRequest(
  request: WorkerRequest,
  emit: (message: WorkerResponse) => void,
): void {
  if (request.type !== 'parse') {
    return;
  }

  try {
    const bytes = new Uint8Array(request.buffer);
    const parsed = parseCsvBytes(bytes, {
      delimiter: request.delimiter,
      onProgress: (progress) => {
        emit({
          type: 'progress',
          id: request.id,
          stage: progress.stage,
          percent: progress.percent,
          rowsParsed: progress.rowsParsed,
        });
      },
    });

    emit({
      type: 'result',
      id: request.id,
      fileName: request.fileName,
      parsed,
    });
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
