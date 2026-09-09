/**
 * Minimal binary min-heap for the event queue.
 *
 * Ties on `time` are broken by insertion sequence so the schedule is a total
 * order — this is what makes a run byte-for-byte reproducible.
 */
export interface HeapItem {
  time: number;
  seq: number;
}

export class MinHeap<T extends HeapItem> {
  private items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (before(items[i], items[parent])) {
        const tmp = items[i];
        items[i] = items[parent];
        items[parent] = tmp;
        i = parent;
      } else break;
    }
  }

  peek(): T | undefined {
    return this.items[0];
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && before(items[l], items[smallest])) smallest = l;
        if (r < items.length && before(items[r], items[smallest])) smallest = r;
        if (smallest === i) break;
        const tmp = items[i];
        items[i] = items[smallest];
        items[smallest] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

function before(a: HeapItem, b: HeapItem): boolean {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}
