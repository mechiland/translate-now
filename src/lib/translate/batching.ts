export interface BatchItem<T> {
  text: string;
  data: T;
}

/**
 * Split items into batches bounded by total characters and item count.
 * An item longer than maxChars gets a batch of its own (never split mid-paragraph).
 */
export function createBatches<T>(
  items: BatchItem<T>[],
  maxChars: number,
  maxSegments: number,
): BatchItem<T>[][] {
  const batches: BatchItem<T>[][] = [];
  let current: BatchItem<T>[] = [];
  let chars = 0;
  for (const item of items) {
    const len = item.text.length;
    if (current.length > 0 && (chars + len > maxChars || current.length >= maxSegments)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
