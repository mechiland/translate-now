import { describe, expect, it } from 'vitest';
import { createBatches } from '@/lib/translate/batching';

const items = (lens: number[]) => lens.map((n, i) => ({ text: 'x'.repeat(n), data: i }));

describe('createBatches', () => {
  it('returns no batches for no items', () => {
    expect(createBatches([], 100, 10)).toEqual([]);
  });

  it('splits by character budget', () => {
    const b = createBatches(items([40, 40, 40, 40]), 100, 10);
    expect(b.map((x) => x.map((i) => i.data))).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('splits by segment count', () => {
    const b = createBatches(items([1, 1, 1, 1, 1]), 1000, 2);
    expect(b.map((x) => x.length)).toEqual([2, 2, 1]);
  });

  it('gives an oversized item its own batch without splitting it', () => {
    const b = createBatches(items([10, 500, 10]), 100, 10);
    expect(b.map((x) => x.map((i) => i.data))).toEqual([[0], [1], [2]]);
  });

  it('preserves order', () => {
    const b = createBatches(items([30, 30, 30, 30, 30, 30, 30]), 100, 10);
    expect(b.flat().map((i) => i.data)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
