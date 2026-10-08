export const LANGUAGES = ["python", "c", "java"] as const;
export type Language = (typeof LANGUAGES)[number];

export type CodeBundle = Record<Language, string>;

export type PipelineInfo = {
  symbolTable: Array<{ name: string; type: string; scope: string; declaredAt: number }>;
  typeDiagnostics: Array<{ nodeIndex: number; expr: string; valid: boolean; message: string }>;
  cfgBlocks: Array<{ id: string; kind: string; nodeIds: string[]; statements: string[]; condition?: string; trueTarget?: string; falseTarget?: string; nextTarget?: string }>;
  tac: Array<{ nodeIndex: number; raw: string; before: string[]; after: string[] }>;
};

export type ProviderInfo = {
  provider: string;
  model: string;
};

export type FlowAnalysis = {
  title: string;
  summary: string;
  algorithm: string[];
  assumptions: string[];
  complexity: {
    time: string;
    space: string;
  };
  confidence: number;
  codes: CodeBundle;
  pipeline: PipelineInfo;
  answeredBy: ProviderInfo;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunResult = {
  output: string;
  exitCode: number | null;
  status: string;
  signal: string | null;
  truncated: boolean;
};
