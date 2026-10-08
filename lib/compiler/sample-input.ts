import { SymbolTable } from "./symbol-table";
import { Stmt } from "./expr-parser";

const DEFAULTS: Record<string, string> = {
  int: "5",
  float: "3.5",
  bool: "true",
  string: "hello",
  unknown: "5",
};

/**
 * Builds a plausible sample stdin for the generated program by walking every
 * Read statement in flowchart order and picking one sane default value per
 * variable from its inferred type. Purely deterministic — no AI call.
 */
export function buildSampleInput(statements: Array<{ stmt: Stmt }>, symbolTable: SymbolTable): string {
  const values: string[] = [];
  for (const { stmt } of statements) {
    if (stmt.kind !== "read") continue;
    for (const name of stmt.names) {
      const type = symbolTable.get(name)?.type ?? "unknown";
      values.push(DEFAULTS[type] ?? DEFAULTS.unknown);
    }
  }
  return values.join(" ");
}
