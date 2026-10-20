/**
 * Minimal Model Context Protocol (MCP) helpers.
 * This module is a placeholder for a future MCP server integration.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export const echoTool: McpTool = {
  name: 'echo',
  description: 'Echoes the provided text back to the caller.',
};

export function listTools(): McpTool[] {
  return [echoTool];
}
