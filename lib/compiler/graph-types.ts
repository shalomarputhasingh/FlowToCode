// The AI vision step (stages 1-5: preprocessing, symbol detection, OCR,
// arrow detection, parsing) only ever has to produce this graph. Every stage
// after this one (6-12) is deterministic TypeScript — no AI involved.

export type NodeShape = "terminal" | "process" | "decision" | "io";

export type FlowNode = {
  id: string;
  shape: NodeShape;
  /** Raw text read off the shape, e.g. "A = B + C", "Read A, B", "A > B". */
  text: string;
};

export type FlowEdge = {
  from: string;
  to: string;
  /** "yes" | "no" | "" — only meaningful out of a decision node. */
  label?: string;
};

export type FlowGraph = {
  startId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
};
