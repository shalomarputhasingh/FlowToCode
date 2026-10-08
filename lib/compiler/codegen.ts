import { Expr, Stmt } from "./expr-parser";
import { IRStmt } from "./cfg";
import { foldConstants } from "./optimize";
import { inferExprType } from "./type-inference";
import { SymbolTable } from "./symbol-table";

export type Lang = "python" | "c" | "java";

function printExpr(expr: Expr, lang: Lang): string {
  switch (expr.kind) {
    case "lit":
      if (expr.type === "string") return JSON.stringify(expr.value);
      if (expr.type === "bool") return lang === "python" ? (expr.value ? "True" : "False") : expr.value ? "true" : "false";
      return String(expr.value);
    case "ident":
      return expr.name;
    case "unary":
      if (expr.op === "!") return lang === "python" ? `not ${printExpr(expr.operand, lang)}` : `!${printExpr(expr.operand, lang)}`;
      return `-${printExpr(expr.operand, lang)}`;
    case "binary": {
      let op = expr.op;
      if (lang === "python") { if (op === "&&") op = "and"; if (op === "||") op = "or"; }
      return `(${printExpr(expr.left, lang)} ${op} ${printExpr(expr.right, lang)})`;
    }
  }
}

function pyPrint(expr: Expr) { return `print(${printExpr(foldConstants(expr), "python")})`; }

function cType(type: string) { return type === "float" ? "double" : type === "string" ? "char" : type === "bool" ? "bool" : "int"; }
function javaType(type: string) { return type === "float" ? "double" : type === "string" ? "String" : type === "bool" ? "boolean" : "int"; }

function printStmt(stmt: Stmt, lang: Lang, table: SymbolTable, indent: string): string[] {
  if (stmt.kind === "assign") {
    const value = printExpr(foldConstants(stmt.expr), lang);
    if (lang === "python") return [`${indent}${stmt.name} = ${value}`];
    return [`${indent}${stmt.name} = ${value};`];
  }
  if (stmt.kind === "read") {
    if (lang === "python") {
      return stmt.names.map((name) => {
        const type = table.get(name)?.type ?? "int";
        const cast = type === "float" ? "float" : type === "string" ? "str" : "int";
        return `${indent}${name} = ${cast}(input())`;
      });
    }
    if (lang === "c") {
      return stmt.names.map((name) => {
        const type = table.get(name)?.type ?? "int";
        const spec = type === "float" ? "%lf" : type === "string" ? "%s" : "%d";
        return `${indent}scanf("${spec}", &${name});`;
      });
    }
    return stmt.names.map((name) => {
      const type = table.get(name)?.type ?? "int";
      const call = type === "float" ? "nextDouble" : type === "string" ? "next" : "nextInt";
      return `${indent}${name} = scanner.${call}();`;
    });
  }
  if (stmt.kind === "write") {
    const folded = foldConstants(stmt.expr);
    if (lang === "python") return [`${indent}${pyPrint(folded)}`];
    if (lang === "c") {
      const type = inferExprType(folded, table);
      const spec = type === "float" ? "%f\\n" : type === "string" ? "%s\\n" : "%d\\n";
      return [`${indent}printf("${spec}", ${printExpr(folded, lang)});`];
    }
    return [`${indent}System.out.println(${printExpr(folded, lang)});`];
  }
  return [];
}

function printBlock(body: IRStmt[], lang: Lang, table: SymbolTable, indent: string): string[] {
  const lines: string[] = [];
  for (const node of body) lines.push(...printIR(node, lang, table, indent));
  return lines;
}

function printIR(node: IRStmt, lang: Lang, table: SymbolTable, indent: string): string[] {
  if (node.kind === "stmt") return printStmt(node.stmt, lang, table, indent);

  const cond = printExpr(foldConstants(node.cond), lang);
  if (node.kind === "while") {
    if (lang === "python") return [`${indent}while ${cond}:`, ...printBlock(node.body, lang, table, indent + "    ")];
    return [
      `${indent}while (${cond}) {`,
      ...printBlock(node.body, lang, table, indent + "    "),
      `${indent}}`,
    ];
  }
  // if/else
  if (lang === "python") {
    const lines = [`${indent}if ${cond}:`, ...(node.then.length ? printBlock(node.then, lang, table, indent + "    ") : [`${indent}    pass`])];
    if (node.else.length) lines.push(`${indent}else:`, ...printBlock(node.else, lang, table, indent + "    "));
    return lines;
  }
  const lines = [`${indent}if (${cond}) {`, ...printBlock(node.then, lang, table, indent + "    "), `${indent}}`];
  if (node.else.length) lines.push(`${indent}else {`, ...printBlock(node.else, lang, table, indent + "    "), `${indent}}`);
  return lines;
}

/** Stage 12: code generation from the structured IR + symbol table for one target language. */
export function generateCode(ir: IRStmt[], table: SymbolTable, lang: Lang): string {
  const body = printBlock(ir, lang, table, lang === "python" ? "" : "    ");
  if (lang === "python") return body.join("\n") || "pass";

  const needsBool = [...table.values()].some((e) => e.type === "bool");
  if (lang === "c") {
    const decls = [...table.values()].map((e) => `    ${cType(e.type)} ${e.name};`);
    return [
      "#include <stdio.h>",
      ...(needsBool ? ["#include <stdbool.h>"] : []),
      "",
      "int main(void) {",
      ...decls,
      ...body,
      "    return 0;",
      "}",
    ].join("\n");
  }
  const decls = [...table.values()].map((e) => `        ${javaType(e.type)} ${e.name};`);
  const usesScanner = [...table.values()].length > 0 && body.some((line) => line.includes("scanner."));
  return [
    "import java.util.Scanner;",
    "",
    "public class Main {",
    "    public static void main(String[] args) {",
    ...(usesScanner ? ["        Scanner scanner = new Scanner(System.in);"] : []),
    ...decls,
    ...body.map((line) => "    " + line),
    "    }",
    "}",
  ].join("\n");
}
