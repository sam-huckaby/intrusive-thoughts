import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { runReview } from "../core/review";

export interface McpServerOptions {
  db: Database;
  promptPath: string;
}

/**
 * Creates and starts the MCP server over stdio transport.
 * Registers the `review_code` tool.
 * This function blocks (runs the stdio event loop) until the client disconnects.
 * @sideeffect Binds to stdio, runs review pipeline
 */
export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const server = createMcpServerInstance(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function createMcpServerInstance(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "intrusive-thoughts",
    version: "0.1.0",
  });
  registerReviewTool(server, options);
  return server;
}

function registerReviewTool(server: McpServer, options: McpServerOptions): void {
  server.tool(
    "review_code",
    {
      taskSummary: z.string().describe(
        "Summary of the task/changes, compiled from user messages to the agent",
      ),
      baseBranch: z.string().optional().describe(
        "Branch to diff against. Defaults to configured base branch (usually 'main')",
      ),
      workingDirectory: z.string().optional().describe(
        "Path to the git repository. Defaults to the current working directory",
      ),
    },
    async ({ taskSummary, baseBranch, workingDirectory }) =>
      handleReviewTool(options, taskSummary, baseBranch, workingDirectory),
  );
}

async function handleReviewTool(
  options: McpServerOptions,
  taskSummary: string,
  baseBranch?: string,
  workingDirectory?: string,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = await runReview(
    { taskSummary, baseBranch, workingDirectory },
    { db: options.db, promptPath: options.promptPath },
  );
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
