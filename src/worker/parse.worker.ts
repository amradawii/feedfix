import { handleWorkerRequest } from './handler';
import { WorkerRequest, WorkerResponse } from './messages';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handleWorkerRequest(event.data, (response: WorkerResponse) => {
    ctx.postMessage(response);
  });
};
