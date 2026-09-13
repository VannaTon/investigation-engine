import type { Span } from "./span.js";

export interface TraceNode extends Span {
  children: TraceNode[];
}
