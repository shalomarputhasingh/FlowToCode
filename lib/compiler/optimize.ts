import { Expr } from "./expr-parser";

/** Stage 11: constant folding directly on an expression tree (used by
 * codegen so folded values show up in the emitted source, not just in the
 * TAC transparency view). */
export function foldConstants(expr: Expr): Expr {
  if (expr.kind === "lit" || expr.kind === "ident") return expr;
  if (expr.kind === "unary") {
    const operand = foldConstants(expr.operand);
    if (operand.kind === "lit") {
      if (expr.op === "-" && typeof operand.value === "number") {
        return { kind: "lit", type: operand.type, value: -operand.value };
      }
      if (expr.op === "!" && typeof operand.value === "boolean") {
        return { kind: "lit", type: "bool", value: !operand.value };
      }
    }
    return { kind: "unary", op: expr.op, operand };
  }
  const left = foldConstants(expr.left);
  const right = foldConstants(expr.right);
  if (left.kind === "lit" && right.kind === "lit" && typeof left.value !== "boolean" && typeof right.value !== "boolean") {
    const l = left.value as number | string;
    const r = right.value as number | string;
    const num = (fn: (a: number, b: number) => number | boolean) => fn(l as number, r as number);
    const table: Record<string, () => string | number | boolean | undefined> = {
      "+": () => (typeof l === "string" || typeof r === "string" ? `${l}${r}` : num((a, b) => a + b)),
      "-": () => num((a, b) => a - b),
      "*": () => num((a, b) => a * b),
      "/": () => (r === 0 ? undefined : num((a, b) => a / b)),
      "%": () => (r === 0 ? undefined : num((a, b) => a % b)),
      ">": () => num((a, b) => a > b),
      "<": () => num((a, b) => a < b),
      ">=": () => num((a, b) => a >= b),
      "<=": () => num((a, b) => a <= b),
      "==": () => l === r,
      "!=": () => l !== r,
    };
    const compute = table[expr.op]?.();
    if (compute !== undefined) {
      const type = typeof compute === "boolean" ? "bool" : typeof compute === "string" ? "string" : (left.type === "float" || right.type === "float") ? "float" : "int";
      return { kind: "lit", type, value: compute };
    }
  }
  return { kind: "binary", op: expr.op, left, right };
}
