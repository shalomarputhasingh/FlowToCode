import { FlowGraph } from "./graph-types";
import { buildCfg, structure, Block } from "./cfg";
import { buildSymbolTable, formatSymbolTable, SymbolEntry } from "./symbol-table";
import { inferTypes } from "./type-inference";
import { typeCheck, TypeDiagnostic } from "./type-checker";
import { statementToTac, eliminateDeadCode, tacToString, NodeTac } from "./tac";
import { generateCode } from "./codegen";
import { exprToString } from "./expr-parser";
import { buildSampleInput } from "./sample-input";

export type PipelineStageResult = {
  symbolTable: Array<{ name: string; type: string; scope: string; declaredAt: number }>;
  typeDiagnostics: TypeDiagnostic[];
  cfgBlocks: Array<{ id: string; kind: string; nodeIds: string[]; statements: string[]; condition?: string; trueTarget?: string; falseTarget?: string; nextTarget?: string }>;
  tac: Array<{ nodeIndex: number; raw: string; before: string[]; after: string[] }>;
  code: { python: string; c: string; java: string };
  sampleInput: string;
};

/**
 * Runs stages 6-12 of the pipeline (everything after AI perception) on a
 * flowchart graph: symbol table, type inference, type checking, CFG, TAC +
 * optimization, and three-language code generation. 100% deterministic —
 * no AI call happens in this function.
 */
export function runCompilerPipeline(graph: FlowGraph): PipelineStageResult {
  const cfg = buildCfg(graph);

  const symbolTable = buildSymbolTable(cfg.orderedStatements);
  inferTypes(symbolTable, cfg.orderedStatements);
  const typeDiagnostics = typeCheck(symbolTable, cfg.orderedStatements);

  const tac: PipelineStageResult["tac"] = cfg.orderedStatements.map(({ nodeIndex, stmt }) => {
    const before = statementToTac(stmt);
    const after = eliminateDeadCode(before);
    return { nodeIndex, raw: stmt.raw, before: before.map(tacToString), after: after.map(tacToString) };
  });

  const ir = structure(cfg, cfg.entry, null);
  const code = {
    python: generateCode(ir, symbolTable, "python"),
    c: generateCode(ir, symbolTable, "c"),
    java: generateCode(ir, symbolTable, "java"),
  };

  const cfgBlocks = [...cfg.blocks.values()].map((block: Block) => ({
    id: block.id,
    kind: block.kind,
    nodeIds: block.nodeIds,
    statements: block.statements.map((s) => s.raw),
    condition: block.condition ? exprToString(block.condition) : undefined,
    trueTarget: block.trueTarget,
    falseTarget: block.falseTarget,
    nextTarget: block.nextTarget,
  }));

  return {
    symbolTable: formatSymbolTable(symbolTable),
    typeDiagnostics,
    cfgBlocks,
    tac,
    code,
    sampleInput: buildSampleInput(cfg.orderedStatements, symbolTable),
  };
}
