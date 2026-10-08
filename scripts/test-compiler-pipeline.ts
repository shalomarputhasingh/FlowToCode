import { runCompilerPipeline } from "../lib/compiler/pipeline";
import type { FlowGraph } from "../lib/compiler/graph-types";

type Case = { name: string; graph: FlowGraph; expectInCode: Record<"python" | "c" | "java", string[]> };

// Case 1: classic even/odd check — tests decision -> if/else structuring,
// type inference (int), and the modulo + comparison operators.
const evenOdd: FlowGraph = {
  startId: "start",
  nodes: [
    { id: "start", shape: "terminal", text: "Start" },
    { id: "read", shape: "io", text: "Read N" },
    { id: "cond", shape: "decision", text: "N % 2 == 0" },
    { id: "even", shape: "process", text: "Result = 1" },
    { id: "odd", shape: "process", text: "Result = 0" },
    { id: "print", shape: "io", text: "Print Result" },
    { id: "end", shape: "terminal", text: "End" },
  ],
  edges: [
    { from: "start", to: "read" },
    { from: "read", to: "cond" },
    { from: "cond", to: "even", label: "Yes" },
    { from: "cond", to: "odd", label: "No" },
    { from: "even", to: "print" },
    { from: "odd", to: "print" },
    { from: "print", to: "end" },
  ],
};

// Case 2: sum 1..N via a loop — tests while-loop recognition (back edge) and
// constant folding (Sum starts at a literal 0).
const sumLoop: FlowGraph = {
  startId: "start",
  nodes: [
    { id: "start", shape: "terminal", text: "Start" },
    { id: "readN", shape: "io", text: "Read N" },
    { id: "initSum", shape: "process", text: "Sum = 0 + 0" }, // deliberately foldable
    { id: "initI", shape: "process", text: "I = 1" },
    { id: "cond", shape: "decision", text: "I <= N" },
    { id: "add", shape: "process", text: "Sum = Sum + I" },
    { id: "inc", shape: "process", text: "I = I + 1" },
    { id: "print", shape: "io", text: "Print Sum" },
    { id: "end", shape: "terminal", text: "End" },
  ],
  edges: [
    { from: "start", to: "readN" },
    { from: "readN", to: "initSum" },
    { from: "initSum", to: "initI" },
    { from: "initI", to: "cond" },
    { from: "cond", to: "add", label: "Yes" },
    { from: "add", to: "inc" },
    { from: "inc", to: "cond" },
    { from: "cond", to: "print", label: "No" },
    { from: "print", to: "end" },
  ],
};

const cases: Case[] = [
  { name: "even/odd (if/else)", graph: evenOdd, expectInCode: {
    python: ["if ((N % 2) == 0):", "Result = 1", "Result = 0", "print(Result)"],
    c: ["if (((N % 2) == 0)) {", "printf(\"%d\\n\", Result)"],
    java: ["if (((N % 2) == 0)) {", "System.out.println(Result)"],
  } },
  { name: "sum loop (while + constant folding)", graph: sumLoop, expectInCode: {
    python: ["Sum = 0", "while (I <= N):", "Sum = (Sum + I)", "I = (I + 1)"],
    c: ["while ((I <= N)) {", "Sum = 0;"],
    java: ["while ((I <= N)) {", "Sum = 0;"],
  } },
];

let failures = 0;
for (const testCase of cases) {
  console.log(`\n=== ${testCase.name} ===`);
  const result = runCompilerPipeline(testCase.graph);
  console.log("Symbol table:", result.symbolTable);
  console.log("Type diagnostics:", result.typeDiagnostics);
  console.log("--- Python ---\n" + result.code.python);
  console.log("--- C ---\n" + result.code.c);
  console.log("--- Java ---\n" + result.code.java);

  for (const lang of ["python", "c", "java"] as const) {
    for (const needle of testCase.expectInCode[lang]) {
      if (!result.code[lang].includes(needle)) {
        failures++;
        console.error(`FAIL [${testCase.name}/${lang}] missing: ${JSON.stringify(needle)}`);
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll compiler pipeline assertions passed.");
}
