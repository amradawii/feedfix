import { Platform } from '../core/model';
import { DetectedDelimiter, ParsedCsv } from '../core/parse';
import { FieldMapping } from '../core/platforms';
import { handleWorkerRequest } from './handler';
import {
  AnalysisResultPayload,
  ProgressWorkerResponse,
  WorkerRequest,
  WorkerResponse,
} from './messages';

export type WorkerProgressCallback = (
  progress: Omit<ProgressWorkerResponse, 'type' | 'id'>,
) => void;

interface PendingJob {
  resolve: (result: AnalysisResultPayload) => void;
  reject: (error: Error) => void;
  onProgress?: WorkerProgressCallback;
}

export class CsvWorkerClient {
  private worker: Worker | null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();

  constructor(worker?: Worker) {
    if (worker) {
      this.worker = worker;
    } else if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    } else {
      // Fallback for non-browser unit test environments (jsdom) without Web Workers
      this.worker = null;
    }

    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (event: ErrorEvent) => {
        const err = new Error(event.message || 'Worker failed while checking the file.');
        for (const job of this.pending.values()) {
          job.reject(err);
        }
        this.pending.clear();
      };
    }
  }

  private handleMessage(msg: WorkerResponse): void {
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
      job.resolve({
        fileName: msg.fileName,
        parsed: msg.parsed,
        detection: msg.detection,
        activePlatform: msg.activePlatform,
        catalog: msg.catalog,
        rules: msg.rules,
        fixPlan: msg.fixPlan,
      });
    } else if (msg.type === 'error') {
      this.pending.delete(msg.id);
      job.reject(new Error(msg.message));
    }
  }

  parseBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    options: {
      delimiter?: DetectedDelimiter;
      platformOverride?: Platform;
      otherMapping?: FieldMapping;
      onProgress?: WorkerProgressCallback;
    } = {},
  ): Promise<AnalysisResultPayload> {
    const id = this.nextId++;
    return new Promise<AnalysisResultPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      const request: WorkerRequest = {
        type: 'parse',
        id,
        fileName,
        buffer,
        delimiter: options.delimiter,
        platformOverride: options.platformOverride,
        otherMapping: options.otherMapping,
      };
      if (this.worker) {
        this.worker.postMessage(request, [buffer]);
      } else {
        void handleWorkerRequest(request, (resp) => this.handleMessage(resp));
      }
    });
  }

  recheck(
    parsed: ParsedCsv,
    fileName: string,
    options: {
      platformOverride?: Platform;
      otherMapping?: FieldMapping;
      onProgress?: WorkerProgressCallback;
    } = {},
  ): Promise<AnalysisResultPayload> {
    const id = this.nextId++;
    return new Promise<AnalysisResultPayload>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: options.onProgress });
      const request: WorkerRequest = {
        type: 'recheck',
        id,
        fileName,
        parsed,
        platformOverride: options.platformOverride,
        otherMapping: options.otherMapping,
      };
      if (this.worker) {
        this.worker.postMessage(request);
      } else {
        void handleWorkerRequest(request, (resp) => this.handleMessage(resp));
      }
    });
  }

  terminate(): void {
    for (const job of this.pending.values()) {
      job.reject(new Error('File processing was cancelled.'));
    }
    this.pending.clear();
    this.worker?.terminate();
  }
}
