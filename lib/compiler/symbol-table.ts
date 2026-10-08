import { Expr, ExprType, Stmt, exprToString } from "./expr-parser";

export type SymbolEntry = {
  name: string;
  type: ExprType;
  scope: "global";
  declaredAt: number; // index of the flowchart node that first introduced it
};

export type SymbolTable = Map<string, SymbolEntry>;

/** Stage 6: build the symbol table from every statement, in flowchart order. */
export function buildSymbolTable(statements: Array<{ nodeIndex: number; stmt: Stmt }>): SymbolTable {
  const table: SymbolTable = new Map();

  const declare = (name: string, nodeIndex: number) => {
    if (!table.has(name)) {
      table.set(name, { name, type: "unknown", scope: "global", declaredAt: nodeIndex });
    }
  };

  const walkExpr = (expr: Expr, nodeIndex: number) => {
    if (expr.kind === "ident") declare(expr.name, nodeIndex);
    if (expr.kind === "unary") walkExpr(expr.operand, nodeIndex);
    if (expr.kind === "binary") { walkExpr(expr.left, nodeIndex); walkExpr(expr.right, nodeIndex); }
  };

  for (const { nodeIndex, stmt } of statements) {
    if (stmt.kind === "assign") { declare(stmt.name, nodeIndex); walkExpr(stmt.expr, nodeIndex); }
    if (stmt.kind === "read") for (const name of stmt.names) declare(name, nodeIndex);
    if (stmt.kind === "write") walkExpr(stmt.expr, nodeIndex);
  }
  return table;
}

export function formatSymbolTable(table: SymbolTable): Array<{ name: string; type: ExprType; scope: string; declaredAt: number }> {
  return [...table.values()].sort((a, b) => a.declaredAt - b.declaredAt);
}

export { exprToString };
