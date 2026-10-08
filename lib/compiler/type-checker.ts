import { Expr, Stmt, exprToString } from "./expr-parser";
import { inferExprType } from "./type-inference";
import { SymbolTable } from "./symbol-table";

export type TypeDiagnostic = {
  nodeIndex: number;
  expr: string;
  valid: boolean;
  message: string;
};

const NUMERIC = new Set(["int", "float"]);

function checkExpr(expr: Expr, table: SymbolTable, nodeIndex: number, out: TypeDiagnostic[]) {
  if (expr.kind === "binary") {
    checkExpr(expr.left, table, nodeIndex, out);
    checkExpr(expr.right, table, nodeIndex, out);
    const leftType = inferExprType(expr.left, table);
    const rightType = inferExprType(expr.right, table);
    const isComparison = ["==", "!=", ">", "<", ">=", "<="].includes(expr.op);
    const isLogical = expr.op === "&&" || expr.op === "||";
    let valid = true;
    let message = "valid";
    if (isLogical) {
      valid = leftType === "bool" && rightType === "bool";
      message = valid ? "valid" : `${exprToString(expr)}: both sides of ${expr.op} must be bool`;
    } else if (expr.op === "+" && (leftType === "string" || rightType === "string")) {
      valid = leftType === "string" && rightType === "string";
      message = valid ? "valid (string concatenation)" : `${exprToString(expr)}: cannot mix string with ${leftType === "string" ? rightType : leftType}`;
    } else if (isComparison) {
      valid = (NUMERIC.has(leftType) && NUMERIC.has(rightType)) || leftType === rightType;
      message = valid ? "valid" : `${exprToString(expr)}: cannot compare ${leftType} with ${rightType}`;
    } else {
      valid = NUMERIC.has(leftType) && NUMERIC.has(rightType);
      message = valid ? "valid" : `${exprToString(expr)}: arithmetic requires numeric operands, got ${leftType} and ${rightType}`;
    }
    out.push({ nodeIndex, expr: exprToString(expr), valid, message });
  }
  if (expr.kind === "unary") checkExpr(expr.operand, table, nodeIndex, out);
}

/** Stage 8: Type checking over every expression in the program. */
export function typeCheck(table: SymbolTable, statements: Array<{ nodeIndex: number; stmt: Stmt }>): TypeDiagnostic[] {
  const diagnostics: TypeDiagnostic[] = [];
  for (const { nodeIndex, stmt } of statements) {
    if (stmt.kind === "assign") checkExpr(stmt.expr, table, nodeIndex, diagnostics);
    if (stmt.kind === "write") checkExpr(stmt.expr, table, nodeIndex, diagnostics);
  }
  return diagnostics;
}
