export function createMinHeap(): any {
  const heap: any = [];
  return {
    get size() {
      return heap.length;
    },
    push(item: any) {
      let index = heap.length;
      heap.push(item);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].cost <= item.cost) break;
        heap[index] = heap[parent];
        index = parent;
      }
      heap[index] = item;
    },
    pop(): any {
      const first = heap[0],
        last = heap.pop();
      if (heap.length) {
        let index = 0;
        while (index * 2 + 1 < heap.length) {
          let child = index * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
          if (heap[child].cost >= last.cost) break;
          heap[index] = heap[child];
          index = child;
        }
        heap[index] = last;
      }
      return first;
    },
  };
}
