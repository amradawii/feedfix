import { DetectedDelimiter, ParsedCsv, ParseProgress } from '../core/parse';
import { WorkerRequest, WorkerResponse } from './messages';

interface PendingJob {
  resolve: (parsed: ParsedCsv) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ParseProgress) => void;
}

export class CsvWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();

  constructor(worker?: Worker) {
    this.worker =
      worker ?? new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const job = this.pending.get(msg.id);
      if (!job) return;

      if (msg.type === 'progress') {
        job.onProgress?.({
          stage: msg.stage,
          percent: msg.percent,
          rowsParsed: msg.rowsParsed,
        });
      } else if (msg.type === 'result') {
        this.pending.delete(msg.id);
        job.resolve(msg.parsed);
      } else if (msg.type === 'error') {
        this.pending.delete(msg.id);
        job.reject(new Error(msg.message));
      }
    };

    this.worker.onerror = (event: ErrorEvent) => {
      const err = new Error(event.message || 'Worker failed while reading the file.');
      for (const job of this.pending.values()) {
        job.reject(err);
      }
      this.pending.clear();
    };
  }

  parseBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    options: { delimiter?: DetectedDelimiter; onProgress?: (progress: ParseProgress) => void } = {},
  ): Promise<ParsedCsv> {
    const id = this.nextId++;
    return new Promise<ParsedCsv>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      const request: WorkerRequest = {
        type: 'parse',
        id,
        fileName,
        buffer,
        delimiter: options.delimiter,
      };
      this.worker.postMessage(request, [buffer]);
    });
  }

  terminate(): void {
    for (const job of this.pending.values()) {
      job.reject(new Error('File processing was cancelled.'));
    }
    this.pending.clear();
    this.worker.terminate();
  }
}
