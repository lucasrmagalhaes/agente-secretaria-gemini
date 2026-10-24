export interface McpHttpConfig {
  host: string;
  port: number;
  path: string;
  authToken?: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  const bare = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return LOOPBACK_HOSTS.has(bare);
}

export function loadMcpHttpConfig(env: NodeJS.ProcessEnv = process.env): McpHttpConfig {
  const host = env.MCP_HOST?.trim() || '127.0.0.1';
  const port = readPort(env.MCP_PORT);
  const path = normalizeMcpPath(env.MCP_PATH);
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  return { host, port, path, ...(authToken ? { authToken } : {}) };
}

export function assertMcpHttpBind(config: Pick<McpHttpConfig, 'host' | 'authToken'>): void {
  if (!isLoopbackHost(config.host) && !config.authToken) {
    throw new Error(
      'MCP_AUTH_TOKEN é obrigatório quando MCP_HOST não é localhost. Defina um token ou use 127.0.0.1.',
    );
  }
}

export function hostnameFromHostHeader(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? '' : value.slice(1, end);
  }
  const firstColon = value.indexOf(':');
  const lastColon = value.lastIndexOf(':');
  if (firstColon === -1) return value;
  if (firstColon !== lastColon) return value;
  return value.slice(0, firstColon);
}

function readPort(value: string | undefined): number {
  if (!value?.trim()) return 3333;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`MCP_PORT inválido: ${value}`);
  }
  return parsed;
}

function normalizeMcpPath(value: string | undefined): string {
  const raw = value?.trim() || '/mcp';
  if (raw.includes('?') || raw.includes('#') || raw.includes('..')) {
    throw new Error(`MCP_PATH inválido: ${value}`);
  }
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash;
}
