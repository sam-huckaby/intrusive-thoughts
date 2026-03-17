import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Database } from "bun:sqlite";
import { runReview } from "../core/review";
import type { ReviewResult } from "../types";
import { ReviewSession } from "./session";
import type { SessionMetadata } from "./session";

export interface McpServerOptions {
  db: Database;
  promptPath: string;
}

export interface McpReviewResponse {
  review: ReviewResult;
  session: SessionMetadata;
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
  const session = createSession(options.db);
  registerReviewTool(server, options, session);
  return server;
}

/**
 * Reads maxReviewRounds from the config table and creates a ReviewSession.
 * The session lives for the lifetime of the MCP server process.
 */
function createSession(db: Database): ReviewSession {
  const row = db.query("SELECT value FROM config WHERE key = ?").get("maxReviewRounds") as
    | { value: string }
    | null;
  const maxRounds = Number(row?.value ?? "5");
  return new ReviewSession(maxRounds);
}

function registerReviewTool(
  server: McpServer,
  options: McpServerOptions,
  session: ReviewSession,
): void {
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
      handleReviewTool(options, session, taskSummary, baseBranch, workingDirectory),
  );
}

async function handleReviewTool(
  options: McpServerOptions,
  session: ReviewSession,
  taskSummary: string,
  baseBranch?: string,
  workingDirectory?: string,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Check if the session has rounds remaining BEFORE running the review
  if (!session.hasRoundsRemaining()) {
    const metadata = session.buildSessionMetadata();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              review: null,
              session: metadata,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const result = await runReview(
    {
      taskSummary,
      baseBranch,
      workingDirectory,
      previousReviews: session.getPreviousReviews(),
    },
    { db: options.db, promptPath: options.promptPath },
  );

  session.recordRound(result);

  const response: McpReviewResponse = {
    review: result,
    session: session.buildSessionMetadata(),
  };

  return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
}
