/**
 * mcp/tools/ingestion-tools.ts — Handler functions for scan MCP tool.
 *
 * Exported functions:
 *   handleScan — scan tool (local directory ingestion)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { StellarScanner } from '../../scanner/index.js';

type McpResponse = { content: [{ type: 'text'; text: string }] };

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

export async function handleScan(args: {
  path: string;
  recursive?: boolean;
  git?: boolean;
  max_kb?: number;
}): Promise<McpResponse> {
  try {
    const scanner = new StellarScanner({
      paths:       [args.path],
      maxFileSize: (args.max_kb ?? 1024) * 1024,
    });

    const result = await scanner.scanPath(args.path, {
      recursive:  args.recursive ?? true,
      includeGit: args.git ?? true,
    });

    const lines: string[] = [
      `Scan: ${args.path} | ${(result.durationMs / 1000).toFixed(2)}s`,
      `  files: ${result.scannedFiles}  new: ${result.createdMemories}  skipped: ${result.skippedFiles}  errors: ${result.errorFiles}`,
    ];

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError(ErrorCode.InternalError, `scan failed: ${String(err)}`);
  }
}
