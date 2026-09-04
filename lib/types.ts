export const LANGUAGES = ["python", "c", "java"] as const;
export type Language = (typeof LANGUAGES)[number];

export type CodeBundle = Record<Language, string>;

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
