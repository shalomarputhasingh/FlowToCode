import { Expr, ExprType, Stmt } from "./expr-parser";
import { SymbolTable } from "./symbol-table";

const NUMERIC: ExprType[] = ["int", "float"];

function widen(a: ExprType, b: ExprType): ExprType {
  if (a === b) return a;
  if (NUMERIC.includes(a) && NUMERIC.includes(b)) return "float";
  if (a === "unknown") return b;
  if (b === "unknown") return a;
  return "unknown";
}

/** Infers an expression's type given the current (possibly partial) symbol table. */
export function inferExprType(expr: Expr, table: SymbolTable): ExprType {
  switch (expr.kind) {
    case "lit": return expr.type;
    case "ident": return table.get(expr.name)?.type ?? "unknown";
    case "unary": return inferExprType(expr.operand, table);
    case "binary": {
      const left = inferExprType(expr.left, table);
      const right = inferExprType(expr.right, table);
      if (["==", "!=", ">", "<", ">=", "<=", "&&", "||"].includes(expr.op)) return "bool";
      if (expr.op === "+" && (left === "string" || right === "string")) return "string";
      return widen(left, right);
    }
  }
}

/**
 * Stage 7: Type inference. Iterates to a fixed point: each assignment or
 * Read gives a symbol a concrete type; repeats until nothing changes (a
 * variable's type can depend on a later-declared one in a loop body).
 */
export function inferTypes(table: SymbolTable, statements: Array<{ nodeIndex: number; stmt: Stmt }>) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 10) {
    changed = false;
    guard++;
    for (const { stmt } of statements) {
      if (stmt.kind === "assign") {
        const entry = table.get(stmt.name);
        const inferred = inferExprType(stmt.expr, table);
        if (entry && entry.type === "unknown" && inferred !== "unknown") {
          entry.type = inferred;
          changed = true;
        }
      }
      if (stmt.kind === "read") {
        for (const name of stmt.names) {
          const entry = table.get(name);
          // A flowchart rarely states the input type explicitly; default to
          // int, the common case for loop counters/keys, unless something
          // else already fixed a type for this name.
          if (entry && entry.type === "unknown") { entry.type = "int"; changed = true; }
        }
      }
    }
  }
  // Anything still unresolved (never assigned, only ever read as unknown) defaults to int.
  for (const entry of table.values()) if (entry.type === "unknown") entry.type = "int";
  return table;
}
