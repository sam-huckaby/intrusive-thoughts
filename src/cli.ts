import { parseArgs as nodeParseArgs } from "util";

export interface ParsedArgs {
  mode: "review" | "serve" | "mcp";
  summary?: string;
  baseBranch?: string;
  dir?: string;
  port?: number;
  reviewers?: string[];
}

const HELP_TEXT = `
intrusive-thoughts — AI Code Review Tool (let the voices guide you)

Usage:
  intrusive-thoughts review --summary "..." [--base main] [--dir /path] [--reviewers slug1,slug2]
  intrusive-thoughts serve [--port 3456]
  intrusive-thoughts mcp

Modes:
  review    Run a code review against the current git changes
  serve     Start the web UI + REST API server
  mcp       Start as an MCP server over stdio

Options:
  --summary     Task summary for the review (required for review mode)
  --base        Base branch to diff against (default: from config)
  --dir         Working directory / git repo path (default: cwd)
  --reviewers   Comma-separated profile slugs to use (default: auto-match)
  --port        HTTP server port (default: from config, usually 3456)
  --help        Show this help message
`.trim();

/**
 * Parses process.argv into a structured ParsedArgs object.
 * Prints help and exits if --help is passed or args are invalid.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const sliced = argv.slice(2);
  if (sliced.includes("--help") || sliced.length === 0) {
    printHelpAndExit();
  }
  const mode = extractMode(sliced);
  const flags = parseFlags(sliced.slice(1));
  return buildParsedArgs(mode, flags);
}

function printHelpAndExit(): never {
  console.log(HELP_TEXT);
  process.exit(0);
}

function extractMode(args: string[]): ParsedArgs["mode"] {
  const mode = args[0];
  if (mode === "review" || mode === "serve" || mode === "mcp") return mode;
  console.error(`Unknown mode: "${mode}". Use review, serve, or mcp.`);
  process.exit(1);
}

interface Flags {
  summary?: string;
  base?: string;
  dir?: string;
  port?: string;
  reviewers?: string;
}

function parseFlags(args: string[]): Flags {
  const { values } = nodeParseArgs({
    args,
    options: {
      summary: { type: "string" },
      base: { type: "string" },
      dir: { type: "string" },
      port: { type: "string" },
      reviewers: { type: "string" },
    },
    strict: false,
  });
  return values as Flags;
}

function buildParsedArgs(mode: ParsedArgs["mode"], flags: Flags): ParsedArgs {
  return {
    mode,
    summary: flags.summary,
    baseBranch: flags.base,
    dir: flags.dir,
    port: flags.port ? Number(flags.port) : undefined,
    reviewers: flags.reviewers
      ? flags.reviewers.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
}
