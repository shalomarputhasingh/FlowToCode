import { Expr, Stmt } from "./expr-parser";

export type TacInstr =
  | { kind: "const"; dest: string; value: string }
  | { kind: "copy"; dest: string; src: string }
  | { kind: "assign"; dest: string; op: string; left: string; right: string }
  | { kind: "unary"; dest: string; op: string; operand: string }
  | { kind: "read"; names: string[] }
  | { kind: "write"; src: string }
  | { kind: "if"; cond: string; trueLabel: string; falseLabel: string };

type Ref = { text: string; constValue?: string | number | boolean };

function literalText(expr: Extract<Expr, { kind: "lit" }>) {
  return expr.type === "string" ? `"${expr.value}"` : String(expr.value);
}

function foldBinary(op: string, left: string | number | boolean, right: string | number | boolean) {
  const l = left as number;
  const r = right as number;
  switch (op) {
    case "+": return typeof left === "string" || typeof right === "string" ? `${left}${right}` : l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/": return r === 0 ? undefined : l / r;
    case "%": return r === 0 ? undefined : l % r;
    case ">": return l > r;
    case "<": return l < r;
    case ">=": return l >= r;
    case "<=": return l <= r;
    case "==": return l === r;
    case "!=": return l !== r;
    case "&&": return Boolean(left) && Boolean(right);
    case "||": return Boolean(left) || Boolean(right);
    default: return undefined;
  }
}

/** Stage 10 (+ inline constant folding): flattens one statement's expression
 * tree into three-address instructions, folding constant subexpressions as
 * they're built and reusing an identical already-computed subexpression
 * (common subexpression elimination) within the same statement. */
export class TacBuilder {
  instrs: TacInstr[] = [];
  private tempSeq = 0;
  private cseCache = new Map<string, Ref>();

  private newTemp() { return `t${++this.tempSeq}`; }

  flatten(expr: Expr): Ref {
    if (expr.kind === "lit") return { text: literalText(expr), constValue: expr.value };
    if (expr.kind === "ident") return { text: expr.name };
    if (expr.kind === "unary") {
      const operand = this.flatten(expr.operand);
      if (operand.constValue !== undefined) {
        const folded = expr.op === "-" ? -(operand.constValue as number) : !operand.constValue;
        return { text: String(folded), constValue: folded };
      }
      const dest = this.newTemp();
      this.instrs.push({ kind: "unary", dest, op: expr.op, operand: operand.text });
      return { text: dest };
    }
    const left = this.flatten(expr.left);
    const right = this.flatten(expr.right);
    if (left.constValue !== undefined && right.constValue !== undefined) {
      const folded = foldBinary(expr.op, left.constValue, right.constValue);
      if (folded !== undefined) return { text: String(folded), constValue: folded };
    }
    const key = `${expr.op}|${left.text}|${right.text}`;
    const cached = this.cseCache.get(key);
    if (cached) return cached; // CSE: identical subexpression already computed
    const dest = this.newTemp();
    this.instrs.push({ kind: "assign", dest, op: expr.op, left: left.text, right: right.text });
    const ref = { text: dest };
    this.cseCache.set(key, ref);
    return ref;
  }
}

export type NodeTac = { nodeIndex: number; raw: string; before: TacInstr[]; after: TacInstr[] };

/** Builds TAC for one statement, then applies dead-code elimination (stage 11). */
export function statementToTac(stmt: Stmt): TacInstr[] {
  const builder = new TacBuilder();
  if (stmt.kind === "assign") {
    const ref = builder.flatten(stmt.expr);
    if (ref.constValue !== undefined) builder.instrs.push({ kind: "const", dest: stmt.name, value: ref.text });
    else builder.instrs.push({ kind: "copy", dest: stmt.name, src: ref.text });
  } else if (stmt.kind === "read") {
    builder.instrs.push({ kind: "read", names: stmt.names });
  } else if (stmt.kind === "write") {
    const ref = builder.flatten(stmt.expr);
    builder.instrs.push({ kind: "write", src: ref.text });
  }
  return builder.instrs;
}

function usedOperands(instr: TacInstr): string[] {
  if (instr.kind === "assign") return [instr.left, instr.right];
  if (instr.kind === "unary") return [instr.operand];
  if (instr.kind === "copy" || instr.kind === "const") return instr.kind === "copy" ? [instr.src] : [];
  if (instr.kind === "write") return [instr.src];
  return [];
}

function destOf(instr: TacInstr): string | null {
  if (instr.kind === "assign" || instr.kind === "unary" || instr.kind === "copy" || instr.kind === "const") return instr.dest;
  return null;
}

/** Stage 11: dead-code elimination — drop temp assignments nothing reads. */
export function eliminateDeadCode(instrs: TacInstr[]): TacInstr[] {
  const live = new Set<string>();
  for (const instr of instrs) for (const operand of usedOperands(instr)) live.add(operand);

  return instrs.filter((instr) => {
    const dest = destOf(instr);
    if (!dest) return true; // read/write/if always kept
    if (!dest.startsWith("t")) return true; // never drop a real program variable
    return live.has(dest);
  });
}

export function tacToString(instr: TacInstr): string {
  switch (instr.kind) {
    case "const": return `${instr.dest} = ${instr.value}`;
    case "copy": return `${instr.dest} = ${instr.src}`;
    case "assign": return `${instr.dest} = ${instr.left} ${instr.op} ${instr.right}`;
    case "unary": return `${instr.dest} = ${instr.op}${instr.operand}`;
    case "read": return `READ ${instr.names.join(", ")}`;
    case "write": return `WRITE ${instr.src}`;
    case "if": return `IF ${instr.cond} GOTO ${instr.trueLabel} ELSE ${instr.falseLabel}`;
  }
}
