import "server-only";

import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

export const flowAnalysisSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5000),
  algorithm: z.array(z.string().trim().min(1).max(1000)).min(1).max(100),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(50),
  complexity: z.object({
    time: z.string().trim().min(1).max(200),
    space: z.string().trim().min(1).max(200),
  }).strict(),
  confidence: z.number().min(0).max(1),
  codes: z.object({
    python: z.string().min(1).max(100_000),
    c: z.string().min(1).max(100_000),
    java: z.string().min(1).max(100_000),
  }).strict(),
}).strict();

export const flowAnalysisJsonSchema = {
  type: "object",
  required: ["title", "summary", "algorithm", "assumptions", "complexity", "confidence", "codes"],
  properties: {
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

const flowAnalysisOutputParser = StructuredOutputParser.fromZodSchema(flowAnalysisSchema);

export const flowAnalysisFormatInstructions = flowAnalysisOutputParser.getFormatInstructions();

export async function parseFlowAnalysisOutput(text: string) {
  return flowAnalysisOutputParser.parse(text);
}
