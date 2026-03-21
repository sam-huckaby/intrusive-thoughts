import { parseArgs as nodeParseArgs } from "util";

export interface ParsedArgs {
  mode: "review" | "serve" | "mcp";
  summary?: string;
  baseBranch?: string;
  dir?: string;
  port?: number;
  reviewers?: string[];
  ephemeral?: boolean;
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
  --ephemeral   Use in-memory DB and bundled defaults only (ideal for CI)
  --help        Show this help message

Configuration Resolution (highest priority wins):
  1. Environment variables       Always checked first
  2. Project-local               .intrusive-thoughts/ in your repo root
  3. User-level (XDG)            ~/.config/intrusive-thoughts/
  4. Bundled defaults            Shipped with the package

  Rules, reviewer profiles, and the prompt template are merged across all
  layers. A project-local rule with the same slug as a bundled rule overrides it.

  The database resolves to:
    INTRUSIVE_THOUGHTS_DB_PATH > ~/.local/share/intrusive-thoughts/data.db
    (falls back to legacy ~/.intrusive-thoughts/data.db if it exists)

Project-Local Configuration:
  Place a .intrusive-thoughts/ directory at your repo root to add
  project-specific rules, reviewer profiles, or a prompt override:

    .intrusive-thoughts/
      rules/           Project-specific review rules (.md files)
      reviewers/       Project-specific reviewer profiles (.md files)
      code-review.md   Project-specific prompt template override

Environment Variables:
  ANTHROPIC_API_KEY               API key for Anthropic provider
  OPENAI_API_KEY                  API key for OpenAI provider
  INTRUSIVE_THOUGHTS_DB_PATH      Override database file path
  INTRUSIVE_THOUGHTS_CONFIG_DIR   Override user config directory
  INTRUSIVE_THOUGHTS_DATA_DIR     Override user data directory
  INTRUSIVE_THOUGHTS_EPHEMERAL=1  Same as --ephemeral flag
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
  ephemeral?: boolean;
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
      ephemeral: { type: "boolean" },
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
    ephemeral: flags.ephemeral || process.env.INTRUSIVE_THOUGHTS_EPHEMERAL === "1",
  };
}
