// Tiny expression tokenizer + parser for the text found inside flowchart
// shapes. Covers what flowcharts actually contain: arithmetic, comparisons,
// boolean logic, identifiers, int/float/string/bool literals, Read/Print
// statements, and assignment.

export type ExprType = "int" | "float" | "string" | "bool" | "unknown";

export type Expr =
  | { kind: "ident"; name: string }
  | { kind: "lit"; type: ExprType; value: string | number | boolean }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "unary"; op: string; operand: Expr };

export type Stmt =
  | { kind: "assign"; name: string; expr: Expr; raw: string }
  | { kind: "read"; names: string[]; raw: string }
  | { kind: "write"; expr: Expr; raw: string }
  | { kind: "noop"; raw: string };

const BINARY_OPS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "+", "-", "*", "/", "%"];

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== ch) j++;
      tokens.push(input.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { tokens.push(two); i += 2; continue; }
    if ("+-*/%()><,".includes(ch)) { tokens.push(ch); i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    i++; // skip anything unrecognized rather than hard failing
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: string[]) {}

  private peek() { return this.tokens[this.pos]; }
  private next() { return this.tokens[this.pos++]; }

  parseExpr(minPrec = 0): Expr {
    let left = this.parseUnary();
    while (true) {
      const op = this.peek();
      if (!op || !BINARY_OPS.includes(op)) break;
      const prec = precedence(op);
      if (prec < minPrec) break;
      this.next();
      const right = this.parseExpr(prec + 1);
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.peek() === "-" || this.peek() === "!") {
      const op = this.next();
      return { kind: "unary", op, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.next();
    if (tok === "(") {
      const expr = this.parseExpr(0);
      if (this.peek() === ")") this.next();
      return expr;
    }
    if (tok === undefined) return { kind: "lit", type: "unknown", value: "" };
    if (/^["'].*["']$/.test(tok)) return { kind: "lit", type: "string", value: tok.slice(1, -1) };
    if (/^\d+$/.test(tok)) return { kind: "lit", type: "int", value: Number(tok) };
    if (/^\d*\.\d+$/.test(tok)) return { kind: "lit", type: "float", value: Number(tok) };
    if (/^(true|false)$/i.test(tok)) return { kind: "lit", type: "bool", value: tok.toLowerCase() === "true" };
    return { kind: "ident", name: tok };
  }
}

function precedence(op: string) {
  if (op === "||") return 1;
  if (op === "&&") return 2;
  if (["==", "!=", ">", "<", ">=", "<="].includes(op)) return 3;
  if (op === "+" || op === "-") return 4;
  if (op === "*" || op === "/" || op === "%") return 5;
  return 0;
}

export function parseExpression(text: string): Expr {
  return new Parser(tokenize(text)).parseExpr(0);
}

const READ_PATTERN = /^(read|input|get|enter)\b[:\s]*/i;
const WRITE_PATTERN = /^(print|display|output|show|write)\b[:\s]*/i;
const ASSIGN_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|<-|:=)\s*(.+)$/;

/** Parses one flowchart statement box (process or I/O shape text) into a Stmt. */
export function parseStatement(raw: string): Stmt {
  const text = raw.trim();
  if (READ_PATTERN.test(text)) {
    const rest = text.replace(READ_PATTERN, "");
    const names = rest.split(/[,\s]+/).map((n) => n.trim()).filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
    return { kind: "read", names, raw: text };
  }
  if (WRITE_PATTERN.test(text)) {
    const rest = text.replace(WRITE_PATTERN, "");
    return { kind: "write", expr: parseExpression(rest), raw: text };
  }
  const assignMatch = text.match(ASSIGN_PATTERN);
  if (assignMatch) {
    return { kind: "assign", name: assignMatch[1], expr: parseExpression(assignMatch[2]), raw: text };
  }
  return { kind: "noop", raw: text };
}

export function exprToString(expr: Expr): string {
  switch (expr.kind) {
    case "ident": return expr.name;
    case "lit": return expr.type === "string" ? `"${expr.value}"` : String(expr.value);
    case "unary": return `${expr.op}${exprToString(expr.operand)}`;
    case "binary": return `(${exprToString(expr.left)} ${expr.op} ${exprToString(expr.right)})`;
  }
}
