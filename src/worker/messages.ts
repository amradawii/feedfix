import { PlatformDetection } from '../core/detect';
import { FixPlan } from '../core/fixes';
import { CatalogModel, Platform } from '../core/model';
import { DetectedDelimiter, ParsedCsv } from '../core/parse';
import { FieldMapping } from '../core/platforms';
import { RuleEngineResult } from '../core/rules';

export interface ParseAndAnalyzeRequest {
  type: 'parse';
  id: number;
  fileName: string;
  buffer: ArrayBuffer;
  delimiter?: DetectedDelimiter;
  platformOverride?: Platform;
  otherMapping?: FieldMapping;
}

export interface RecheckRequest {
  type: 'recheck';
  id: number;
  fileName: string;
  parsed: ParsedCsv;
  platformOverride?: Platform;
  otherMapping?: FieldMapping;
}

export type WorkerRequest = ParseAndAnalyzeRequest | RecheckRequest;

export interface ProgressWorkerResponse {
  type: 'progress';
  id: number;
  stage: 'decoding' | 'parsing' | 'checking';
  percent: number;
  rowsParsed?: number;
}

export interface AnalysisResultPayload {
  fileName: string;
  parsed: ParsedCsv;
  detection: PlatformDetection;
  activePlatform: Platform;
  catalog: CatalogModel;
  rules: RuleEngineResult;
  fixPlan: FixPlan;
}

export interface ResultWorkerResponse extends AnalysisResultPayload {
  type: 'result';
  id: number;
}

export interface ErrorWorkerResponse {
  type: 'error';
  id: number;
  code: 'LIMIT_EXCEEDED' | 'EMPTY_FILE' | 'PARSE_ERROR';
  message: string;
}

export type WorkerResponse = ProgressWorkerResponse | ResultWorkerResponse | ErrorWorkerResponse;
