import { describe, expect, it } from 'vitest';
import { handleWorkerRequest } from '../src/worker/handler';
import { WorkerResponse } from '../src/worker/messages';

describe('parse worker handler', () => {
  it('emits progress and full analysis result for a valid file', async () => {
    const csv =
      'id\ttitle\tdescription\tlink\timage_link\tavailability\tprice\nSKU-1\tLinen Shirt\tSoft shirt\thttps://example.com/1\thttps://example.com/1.jpg\tin_stock\t25.00 USD\nSKU-2\tWool Hat\tWarm hat\thttps://example.com/2\thttps://example.com/2.jpg\tin_stock\t18.00 USD\n';
    const bytes = new TextEncoder().encode(csv);
    const responses: WorkerResponse[] = [];

    await handleWorkerRequest(
      {
        type: 'parse',
        id: 1,
        fileName: 'feed.tsv',
        buffer: bytes.buffer,
      },
      (msg) => responses.push(msg),
    );

    const progressEvents = responses.filter((r) => r.type === 'progress');
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);

    const final = responses[responses.length - 1];
    expect(final.type).toBe('result');
    if (final.type === 'result') {
      expect(final.id).toBe(1);
      expect(final.fileName).toBe('feed.tsv');
      expect(final.parsed.delimiter).toBe('\t');
      expect(final.parsed.rows).toHaveLength(2);
      expect(final.activePlatform).toBe('google');
      expect(final.catalog.products).toHaveLength(2);
    }
  });

  it('emits a typed error response for empty files', async () => {
    const responses: WorkerResponse[] = [];
    await handleWorkerRequest(
      {
        type: 'parse',
        id: 2,
        fileName: 'empty.csv',
        buffer: new ArrayBuffer(0),
      },
      (msg) => responses.push(msg),
    );

    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      type: 'error',
      id: 2,
      code: 'EMPTY_FILE',
    });
  });
});
