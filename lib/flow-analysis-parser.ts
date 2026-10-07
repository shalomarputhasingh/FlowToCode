import "server-only";

import { z } from "zod";

const analysisFields = {
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5000),
  algorithm: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(50),
  complexity: z.object({
    time: z.string().trim().min(1).max(200),
    space: z.string().trim().min(1).max(200),
  }),
  confidence: z.number().min(0).max(1),
  codes: z.object({
    python: z.string().min(1).max(100_000),
    c: z.string().min(1).max(100_000),
    java: z.string().min(1).max(100_000),
  }),
};

export const flowAnalysisSchema = z.object(analysisFields).strip();

export const flowchartVerdictSchema = z.discriminatedUnion("isFlowchart", [
  z.object({
    isFlowchart: z.literal(true),
    reason: z.string().trim().max(1000).optional(),
    ...analysisFields,
  }).strip(),
  z.object({
    isFlowchart: z.literal(false),
    reason: z.string().trim().min(1).max(1000),
  }).strip(),
]);

export type FlowchartVerdict = z.infer<typeof flowchartVerdictSchema>;

export const flowAnalysisJsonSchema = {
  type: "object",
  required: ["isFlowchart", "reason"],
  properties: {
    isFlowchart: { type: "boolean" },
    reason: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    algorithm: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    complexity: {
      type: "object",
      required: ["time", "space"],
      properties: {
        time: { type: "string" },
        space: { type: "string" },
      },
    },
    confidence: { type: "number" },
    codes: {
      type: "object",
      required: ["python", "c", "java"],
      properties: {
        python: { type: "string" },
        c: { type: "string" },
        java: { type: "string" },
      },
    },
  },
};

// Providers without schema enforcement (Groq) get the shape spelled out.
export const flowAnalysisFormatInstructions = `Respond with a single JSON object and nothing else (no Markdown fences).
If the image is NOT a flowchart, return {"isFlowchart": false, "reason": "<one sentence saying what the image shows>"}.
If it is a flowchart, return:
{"isFlowchart": true, "reason": "<short note>", "title": string, "summary": string, "algorithm": string[], "assumptions": string[], "complexity": {"time": string, "space": string}, "confidence": number (0-1), "codes": {"python": string, "c": string, "java": string}}`;

function extractJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("No JSON object in model output.");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export function parseFlowAnalysisOutput(text: string): FlowchartVerdict {
  return flowchartVerdictSchema.parse(extractJson(text));
}
