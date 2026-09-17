#!/usr/bin/env node
/**
 * Local TypeSafe MCP bridge.
 *
 * TypeSafe documents an HTTP API and agent skill, but no hosted MCP endpoint.
 * This adapter exposes the documented System One API as one local MCP tool.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_URL = "https://api.typesafe.ai/v1/systemone";

const server = new Server(
  { name: "typesafe", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "typesafe_system_one",
    description: "Ask TypeSafe Jev typed Choice, Score, and Noul questions against application state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["state", "questions"],
      properties: {
        state: {
          description: "The state to evaluate. Use a string or a JSON-compatible object.",
          type: ["string", "object"],
        },
        model: {
          description: "TypeSafe model identifier.",
          type: "string",
          default: "jev-latest",
        },
        questions: {
          description: "Named TypeSafe Choice, Score, or Noul questions.",
          type: "object",
          additionalProperties: true,
        },
      },
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "typesafe_system_one") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("TYPESAFE_API_KEY is required for the TypeSafe MCP bridge.");
  }

  const args = request.params.arguments ?? {};
  if (args.state === undefined || !args.questions || typeof args.questions !== "object") {
    throw new Error("typesafe_system_one requires state and questions.");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      state: args.state,
      model: args.model || "jev-latest",
      questions: args.questions,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TypeSafe API ${response.status}: ${text}`);
  }

  return {
    content: [{ type: "text", text }],
    structuredContent: JSON.parse(text),
  };
});

await server.connect(new StdioServerTransport());
