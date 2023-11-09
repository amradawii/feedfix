import { DetectedDelimiter, ParsedCsv, ParseProgress } from '../core/parse';

export interface ParseWorkerRequest {
  type: 'parse';
  id: number;
  fileName: string;
  buffer: ArrayBuffer;
  delimiter?: DetectedDelimiter;
}

export type WorkerRequest = ParseWorkerRequest;

export interface ProgressWorkerResponse {
  type: 'progress';
  id: number;
  stage: ParseProgress['stage'];
  percent: number;
  rowsParsed?: number;
}

export interface ResultWorkerResponse {
  type: 'result';
  id: number;
  fileName: string;
  parsed: ParsedCsv;
}

export interface ErrorWorkerResponse {
  type: 'error';
  id: number;
  code: 'LIMIT_EXCEEDED' | 'EMPTY_FILE' | 'PARSE_ERROR';
  message: string;
}

export type WorkerResponse = ProgressWorkerResponse | ResultWorkerResponse | ErrorWorkerResponse;
