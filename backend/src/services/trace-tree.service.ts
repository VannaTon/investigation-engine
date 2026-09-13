import type { Span } from "../types/span.js";
import type { TraceNode } from "../types/trace-tree.js";

export class TraceTreeService {
  build(spans: Span[]): TraceNode[] {
    const roots: TraceNode[] = [];
    const nodes = new Map<string, TraceNode>();

    for (const span of spans) {
      nodes.set(span.spanId, {
        ...span,
        children: [],
      });
    }

    for (const span of spans) {
      const node = nodes.get(span.spanId)!;

      if (span.parentSpanId == null) {
        roots.push(node);
      } else {
        const parent = nodes.get(span.parentSpanId);

        if (parent) {
          parent.children.push(node);
        }
      }
    }
    return roots;
  }
}
