import "server-only";

import { z } from "zod";

// The AI's job is pure perception (stages 1-5): read shapes, text, and
// arrows off the image into this graph. Everything after that — symbol
// table, types, CFG, TAC, optimization, and code generation — is handled
// by the deterministic compiler pipeline in lib/compiler/, never by the model.
const graphSchema = z.object({
  startId: z.string().trim().min(1).max(100),
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    shape: z.enum(["terminal", "process", "decision", "io"]),
    text: z.string().trim().min(0).max(500),
  })).min(1).max(200),
  edges: z.array(z.object({
    from: z.string().trim().min(1).max(100),
    to: z.string().trim().min(1).max(100),
    label: z.string().trim().max(50).optional(),
  })).max(400),
}).strip();

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
  graph: graphSchema,
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
export type FlowGraphInput = z.infer<typeof graphSchema>;

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
    graph: {
      type: "object",
      required: ["startId", "nodes", "edges"],
      properties: {
        startId: { type: "string" },
        nodes: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "shape", "text"],
            properties: {
              id: { type: "string" },
              shape: { type: "string", enum: ["terminal", "process", "decision", "io"] },
              text: { type: "string" },
            },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            required: ["from", "to"],
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
            },
          },
        },
      },
    },
  },
};

// Providers without schema enforcement (Groq) get the shape spelled out.
export const flowAnalysisFormatInstructions = `Respond with a single JSON object and nothing else (no Markdown fences).
If the image is NOT a flowchart, return {"isFlowchart": false, "reason": "<one sentence saying what the image shows>"}.
If it is a flowchart, return:
{"isFlowchart": true, "reason": "<short note>", "title": string, "summary": string, "algorithm": string[], "assumptions": string[], "complexity": {"time": string, "space": string}, "confidence": number (0-1),
 "graph": {
   "startId": "<id of the Start/entry terminal node>",
   "nodes": [{"id": string, "shape": "terminal"|"process"|"decision"|"io", "text": string}],
   "edges": [{"from": string, "to": string, "label": "Yes"|"No"|""}]
 }}
Every process/io node's "text" must be a single statement in the exact form "NAME = expression", "Read NAME[, NAME...]", or "Print expression" using only + - * / % and comparisons > < >= <= == != and && || ! — because this text is parsed by a real deterministic compiler afterward, not re-interpreted by you. Every decision node's "text" must be a bare boolean condition, e.g. "N % 2 == 0". Label every edge leaving a decision node "Yes" or "No" to match the diagram's branch.`;

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
