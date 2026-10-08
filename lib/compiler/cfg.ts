import { Expr, Stmt, parseExpression, parseStatement } from "./expr-parser";
import { FlowGraph, FlowNode } from "./graph-types";

export type Block = {
  id: string;
  nodeIds: string[];
  kind: "normal" | "decision" | "exit";
  statements: Stmt[];
  condition?: Expr;
  trueTarget?: string;
  falseTarget?: string;
  nextTarget?: string;
};

export type Cfg = {
  entry: string;
  blocks: Map<string, Block>;
  /** Parsed statements in flowchart node order, tagged with their source node index — feeds the symbol table / type stages. */
  orderedStatements: Array<{ nodeIndex: number; stmt: Stmt }>;
};

function isYes(label: string | undefined) { return /^(yes|true|y)$/i.test((label ?? "").trim()); }
function isNo(label: string | undefined) { return /^(no|false|n)$/i.test((label ?? "").trim()); }

/** Stage 9: builds the control-flow graph (basic blocks + edges) straight from the flowchart's own shapes and arrows. */
export function buildCfg(graph: FlowGraph): Cfg {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outEdges = new Map<string, Array<{ to: string; label?: string }>>();
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) { outEdges.set(node.id, []); inDegree.set(node.id, 0); }
  for (const edge of graph.edges) {
    outEdges.get(edge.from)?.push({ to: edge.to, label: edge.label });
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const outDegree = (id: string) => outEdges.get(id)?.length ?? 0;
  const singlePred = (id: string): string | null => {
    const preds = graph.edges.filter((e) => e.to === id).map((e) => e.from);
    return preds.length === 1 ? preds[0] : null;
  };

  const isLeader = (node: FlowNode) => {
    if (node.id === graph.startId) return true;
    if (node.shape === "decision" || node.shape === "terminal") return true;
    if ((inDegree.get(node.id) ?? 0) !== 1) return true;
    const pred = singlePred(node.id);
    if (!pred || outDegree(pred) !== 1) return true;
    // A terminal/decision predecessor never merges forward even with one successor.
    const predNode = byId.get(pred);
    if (predNode && (predNode.shape === "terminal" || predNode.shape === "decision")) return true;
    return false;
  };

  const orderedStatements: Array<{ nodeIndex: number; stmt: Stmt }> = [];
  const blocks = new Map<string, Block>();
  const nodeToBlock = new Map<string, string>();

  let nodeIndex = 0;
  for (const node of graph.nodes) {
    if (!isLeader(node)) { nodeIndex++; continue; }
    const nodeIds: string[] = [];
    const statements: Stmt[] = [];
    let cursor: FlowNode | undefined = node;
    let cursorIndex = nodeIndex;
    while (cursor) {
      nodeToBlock.set(cursor.id, node.id);
      nodeIds.push(cursor.id);
      if (cursor.shape === "process" || cursor.shape === "io") {
        const stmt = parseStatement(cursor.text);
        statements.push(stmt);
        orderedStatements.push({ nodeIndex: cursorIndex, stmt });
      }
      if (cursor.shape === "decision" || cursor.shape === "terminal") break;
      const outs = outEdges.get(cursor.id) ?? [];
      if (outs.length !== 1) break;
      const next = byId.get(outs[0].to);
      if (!next || isLeader(next)) break;
      cursor = next;
      cursorIndex++;
    }
    const last = byId.get(nodeIds[nodeIds.length - 1])!;
    const outs = outEdges.get(last.id) ?? [];

    if (last.shape === "terminal" && outs.length === 0) {
      blocks.set(node.id, { id: node.id, nodeIds, kind: "exit", statements });
    } else if (last.shape === "decision") {
      const yesEdge = outs.find((e) => isYes(e.label)) ?? outs[0];
      const noEdge = outs.find((e) => isNo(e.label)) ?? outs.find((e) => e.to !== yesEdge?.to) ?? outs[1];
      blocks.set(node.id, {
        id: node.id,
        nodeIds,
        kind: "decision",
        statements: [],
        condition: parseExpression(last.text),
        trueTarget: yesEdge?.to,
        falseTarget: noEdge?.to,
      });
    } else {
      blocks.set(node.id, { id: node.id, nodeIds, kind: "normal", statements, nextTarget: outs[0]?.to });
    }
    nodeIndex = cursorIndex + 1;
  }

  // Resolve every target reference to the leader (block) id that owns it.
  const resolve = (id: string | undefined) => (id ? nodeToBlock.get(id) ?? id : undefined);
  for (const block of blocks.values()) {
    if (block.nextTarget) block.nextTarget = resolve(block.nextTarget);
    if (block.trueTarget) block.trueTarget = resolve(block.trueTarget);
    if (block.falseTarget) block.falseTarget = resolve(block.falseTarget);
  }

  return { entry: nodeToBlock.get(graph.startId) ?? graph.startId, blocks, orderedStatements };
}

function reachableFrom(cfg: Cfg, start: string | undefined): Set<string> {
  const seen = new Set<string>();
  if (!start) return seen;
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const block = cfg.blocks.get(id);
    if (!block) continue;
    if (block.nextTarget) stack.push(block.nextTarget);
    if (block.trueTarget) stack.push(block.trueTarget);
    if (block.falseTarget) stack.push(block.falseTarget);
  }
  return seen;
}

export type IRStmt =
  | { kind: "stmt"; stmt: Stmt }
  | { kind: "if"; cond: Expr; then: IRStmt[]; else: IRStmt[] }
  | { kind: "while"; cond: Expr; body: IRStmt[] };

function findJoin(cfg: Cfg, a: string | undefined, b: string | undefined, stopAt: string | null): string | null {
  const fromA = [...reachableFrom(cfg, a)];
  const setB = reachableFrom(cfg, b);
  for (const id of fromA) if (setB.has(id)) return id;
  return stopAt;
}

/** Stage 12 prerequisite: recovers structured if/while control flow from the raw block graph (classic flowchart -> code structuring). */
export function structure(cfg: Cfg, id: string | undefined, stopAt: string | null, guard = { n: 0 }): IRStmt[] {
  guard.n++;
  if (!id || id === stopAt || guard.n > 500) return [];
  const block = cfg.blocks.get(id);
  if (!block || block.kind === "exit") return [];

  if (block.kind === "normal") {
    const out = block.statements.map((stmt): IRStmt => ({ kind: "stmt", stmt }));
    return [...out, ...structure(cfg, block.nextTarget, stopAt, guard)];
  }

  const cond = block.condition!;
  const trueLoops = reachableFrom(cfg, block.trueTarget).has(id);
  const falseLoops = reachableFrom(cfg, block.falseTarget).has(id);

  if (trueLoops && !falseLoops) {
    const body = structure(cfg, block.trueTarget, id, guard);
    return [{ kind: "while", cond, body }, ...structure(cfg, block.falseTarget, stopAt, guard)];
  }
  if (falseLoops && !trueLoops) {
    const body = structure(cfg, block.falseTarget, id, guard);
    return [{ kind: "while", cond: { kind: "unary", op: "!", operand: cond }, body }, ...structure(cfg, block.trueTarget, stopAt, guard)];
  }

  const join = findJoin(cfg, block.trueTarget, block.falseTarget, stopAt);
  const thenBody = structure(cfg, block.trueTarget, join, guard);
  const elseBody = structure(cfg, block.falseTarget, join, guard);
  return [{ kind: "if", cond, then: thenBody, else: elseBody }, ...structure(cfg, join ?? undefined, stopAt, guard)];
}
