import { z, type ZodType } from 'zod';
import type { FunctionDeclaration } from '@google/genai';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodType;
  handler: (args: never) => Promise<unknown>;
}

export type ToolOutcome =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export function defineTool<T extends ZodType>(tool: {
  name: string;
  description: string;
  schema: T;
  handler: (args: z.infer<T>) => Promise<unknown>;
}): ToolDefinition {
  return tool as ToolDefinition;
}

export class ToolRegistry {
  constructor(private readonly tools: ToolDefinition[]) {}

  list(): ToolDefinition[] {
    return this.tools;
  }

  declarations(): FunctionDeclaration[] {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: parametersJsonSchema(tool.schema),
    }));
  }

  async execute(name: string, args: unknown): Promise<ToolOutcome> {
    const tool = this.tools.find((item) => item.name === name);
    if (!tool) {
      return { ok: false, error: `Ferramenta desconhecida: ${name}` };
    }

    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      return { ok: false, error: formatZodError(parsed.error) };
    }

    try {
      const data = await tool.handler(parsed.data as never);
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao executar a ferramenta.';
      return { ok: false, error: message };
    }
  }
}

export function parametersJsonSchema(schema: ZodType): unknown {
  const json = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'argumentos';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
