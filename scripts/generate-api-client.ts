#!/usr/bin/env bun

type HttpMethod = "delete" | "get" | "patch" | "post" | "put";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  nullable?: boolean;
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: JsonSchema;
}

interface OpenApiMediaType {
  schema?: JsonSchema;
}

interface OpenApiOperation {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, OpenApiMediaType>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, OpenApiMediaType>;
    }
  >;
}

interface OpenApiSpec {
  paths?: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
}

interface GeneratedOperation {
  name: string;
  method: Uppercase<HttpMethod>;
  path: string;
  paramsType: string;
  queryType: string;
  bodyType: string;
  responseType: string;
}

const METHOD_ORDER: HttpMethod[] = ["get", "post", "put", "patch", "delete"];
const GENERATED_PATH = "packages/api-client/src/index.ts";

function literal(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  return "unknown";
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function indent(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `${pad}${line}` : line))
    .join("\n");
}

function objectSchemaToType(schema: JsonSchema): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines: string[] = [];

  for (const [name, propSchema] of Object.entries(properties)) {
    const optional = required.has(name) ? "" : "?";
    lines.push(`${propertyName(name)}${optional}: ${schemaToType(propSchema)};`);
  }

  const additional = schema.additionalProperties;
  if (additional && typeof additional === "object") {
    lines.push(`[key: string]: ${schemaToType(additional)};`);
  } else if (additional === true) {
    lines.push("[key: string]: unknown;");
  }

  if (lines.length === 0) {
    if (additional && typeof additional === "object") {
      return `Record<string, ${schemaToType(additional)}>`;
    }
    if (additional === true) return "Record<string, unknown>";
    return "Record<string, unknown>";
  }

  return `{\n${indent(lines.join("\n"), 2)}\n}`;
}

function schemaToType(schema: JsonSchema | undefined): string {
  if (!schema) return "unknown";

  const nullable = schema.nullable ? " | null" : "";

  if ("const" in schema) return `${literal(schema.const)}${nullable}`;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `${schema.enum.map(literal).join(" | ")}${nullable}`;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return `${schema.anyOf.map(schemaToType).join(" | ")}${nullable}`;
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return `${schema.oneOf.map(schemaToType).join(" | ")}${nullable}`;
  }
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return `${schema.allOf.map((part) => `(${schemaToType(part)})`).join(" & ")}${nullable}`;
  }

  const schemaType = schema.type;
  if (Array.isArray(schemaType)) {
    return `${schemaType.map((type) => schemaToType({ ...schema, type })).join(" | ")}${nullable}`;
  }

  if (schema.properties) return `${objectSchemaToType(schema)}${nullable}`;

  switch (schemaType) {
    case "array":
      return `Array<${schemaToType(schema.items)}>${nullable}`;
    case "boolean":
      return `boolean${nullable}`;
    case "integer":
    case "number":
      return `number${nullable}`;
    case "null":
      return "null";
    case "object":
      return `${objectSchemaToType(schema)}${nullable}`;
    case "string":
      return `string${nullable}`;
    default:
      return `unknown${nullable}`;
  }
}

function parametersToType(parameters: OpenApiParameter[] | undefined, location: "path" | "query") {
  const selected = (parameters ?? []).filter((param) => param.in === location);
  if (selected.length === 0) return "EmptyObject";

  const lines = selected.map((param) => {
    const optional = param.required ? "" : "?";
    return `${propertyName(param.name)}${optional}: ${schemaToType(param.schema)};`;
  });

  return `{\n${indent(lines.join("\n"), 2)}\n}`;
}

function pickJsonContent(content: Record<string, OpenApiMediaType> | undefined): OpenApiMediaType | undefined {
  if (!content) return undefined;
  return content["application/json"] ?? Object.values(content)[0];
}

function requestBodyToType(operation: OpenApiOperation): string {
  const mediaType = pickJsonContent(operation.requestBody?.content);
  if (!mediaType) return "never";
  return schemaToType(mediaType.schema);
}

function responseToType(operation: OpenApiOperation): string {
  const responses = operation.responses ?? {};
  const success = Object.entries(responses)
    .filter(([code]) => /^2\d\d$/.test(code))
    .sort(([a], [b]) => Number(a) - Number(b))[0];

  if (!success) return "unknown";
  const [status, response] = success;
  if (status === "204") return "void";
  const mediaType = pickJsonContent(response.content);
  return mediaType?.schema ? schemaToType(mediaType.schema) : "unknown";
}

function toOperationName(method: HttpMethod, path: string, operation: OpenApiOperation): string {
  const raw = operation.operationId ?? `${method} ${path}`;
  const words = raw
    .replace(/[{}]/g, " ")
    .replace(/@/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const [first = "operation", ...rest] = words;
  const base = [
    first.charAt(0).toLowerCase() + first.slice(1),
    ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)),
  ].join("");

  return /^[A-Za-z_$]/.test(base) ? base : `operation${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}

function collectOperations(spec: OpenApiSpec): GeneratedOperation[] {
  const operations: GeneratedOperation[] = [];
  const usedNames = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of METHOD_ORDER) {
      const operation = pathItem[method];
      if (!operation) continue;

      const baseName = toOperationName(method, path, operation);
      const seen = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, seen + 1);
      const name = seen === 0 ? baseName : `${baseName}${seen + 1}`;

      operations.push({
        name,
        method: method.toUpperCase() as Uppercase<HttpMethod>,
        path,
        paramsType: parametersToType(operation.parameters, "path"),
        queryType: parametersToType(operation.parameters, "query"),
        bodyType: requestBodyToType(operation),
        responseType: responseToType(operation),
      });
    }
  }

  return operations.sort((a, b) => a.name.localeCompare(b.name));
}

function generate(operations: GeneratedOperation[]): string {
  const operationTypes = operations
    .map(
      (operation) =>
        `${propertyName(operation.name)}: ApiOperation<${operation.paramsType}, ${operation.queryType}, ${operation.bodyType}, ${operation.responseType}>;`,
    )
    .join("\n");

  const operationMetadata = operations
    .map(
      (operation) =>
        `${propertyName(operation.name)}: { method: ${JSON.stringify(operation.method)}, path: ${JSON.stringify(operation.path)} },`,
    )
    .join("\n");

  return `// This file was generated by scripts/generate-api-client.ts. Do not edit manually.

export type EmptyObject = Record<never, never>;
export type HeaderInit = ConstructorParameters<typeof Headers>[0];
export type HttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface ApiOperation<Params extends object, Query extends object, Body, ResponseBody> {
  params: Params;
  query: Query;
  body: Body;
  response: ResponseBody;
}

export interface ApiOperations {
${indent(operationTypes, 2)}
}

export type ApiOperationName = keyof ApiOperations;

export interface OperationMetadata {
  method: HttpMethod;
  path: string;
}

export const operations = {
${indent(operationMetadata, 2)}
} as const satisfies Record<ApiOperationName, OperationMetadata>;

type RequiredKeys<T extends object> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

type ParamsArg<T extends object> = keyof T extends never ? EmptyObject : { params: T };
type QueryArg<T extends object> = keyof T extends never
  ? EmptyObject
  : RequiredKeys<T> extends never
    ? { query?: T }
    : { query: T };
type BodyArg<T> = [T] extends [never] ? EmptyObject : { body: T };

export type OperationRequest<K extends ApiOperationName> = ParamsArg<ApiOperations[K]["params"]> &
  QueryArg<ApiOperations[K]["query"]> &
  BodyArg<ApiOperations[K]["body"]>;

export type OperationResponse<K extends ApiOperationName> = ApiOperations[K]["response"];

type RequestArgs<K extends ApiOperationName> = RequiredKeys<OperationRequest<K>> extends never
  ? [request?: OperationRequest<K>, init?: RequestInit]
  : [request: OperationRequest<K>, init?: RequestInit];

export interface ApiClientOptions {
  baseUrl?: string | URL;
  apiKey?: string;
  agentId?: string;
  fetch?: typeof fetch;
  headers?: HeaderInit | (() => HeaderInit | Promise<HeaderInit>);
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: unknown;
  readonly response: Response;

  constructor(response: Response, body: unknown) {
    super(\`Agent Swarm API request failed: \${response.status} \${response.statusText}\`);
    this.name = "ApiClientError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
    this.response = response;
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  return {
    request<K extends ApiOperationName>(
      operation: K,
      ...args: RequestArgs<K>
    ): Promise<OperationResponse<K>> {
      return requestOperation(options, operation, ...args);
    },
  };
}

export async function requestOperation<K extends ApiOperationName>(
  options: ApiClientOptions,
  operation: K,
  ...args: RequestArgs<K>
): Promise<OperationResponse<K>> {
  const metadata = operations[operation];
  const request = (args[0] ?? {}) as {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
  };
  const init = (args[1] ?? {}) as RequestInit;
  const fetchImpl = options.fetch ?? fetch;
  const headers = new Headers(init.headers);
  await applyHeaders(headers, options.headers);

  if (options.apiKey && !headers.has("Authorization")) {
    headers.set("Authorization", \`Bearer \${options.apiKey}\`);
  }
  if (options.agentId && !headers.has("X-Agent-ID")) {
    headers.set("X-Agent-ID", options.agentId);
  }

  const hasJsonBody = Object.hasOwn(request, "body");
  if (hasJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchImpl(buildUrl(options.baseUrl, metadata.path, request), {
    ...init,
    method: metadata.method,
    headers,
    body: hasJsonBody ? JSON.stringify(request.body ?? null) : init.body,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new ApiClientError(response, body);
  }

  return body as OperationResponse<K>;
}

async function applyHeaders(
  headers: Headers,
  source: ApiClientOptions["headers"],
): Promise<void> {
  if (!source) return;
  const resolved = typeof source === "function" ? await source() : source;
  for (const [key, value] of new Headers(resolved)) {
    headers.set(key, value);
  }
}

function buildUrl(
  baseUrl: string | URL | undefined,
  pathTemplate: string,
  request: { params?: Record<string, unknown>; query?: Record<string, unknown> },
): URL {
  const base = new URL(String(baseUrl ?? "http://localhost:3013").replace(/\\/?$/, "/"));
  const path = pathTemplate.replace(/\\{([^}]+)\\}/g, (_, name: string) => {
    const value = request.params?.[name];
    if (value === undefined || value === null) {
      throw new Error(\`Missing path parameter: \${name}\`);
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(path.replace(/^\\//, ""), base);

  for (const [key, value] of Object.entries(request.query ?? {})) {
    appendQueryValue(url, key, value);
  }

  return url;
}

function appendQueryValue(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(url, key, item);
    return;
  }
  if (typeof value === "object") {
    url.searchParams.append(key, JSON.stringify(value));
    return;
  }
  url.searchParams.append(key, String(value));
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }
  return text;
}
`;
}

async function main() {
  const spec = (await Bun.file("openapi.json").json()) as OpenApiSpec;
  const operations = collectOperations(spec);
  if (operations.length === 0) {
    throw new Error("No OpenAPI operations found in openapi.json");
  }

  await Bun.write(GENERATED_PATH, generate(operations));
  await Bun.$`bunx biome format --write ${GENERATED_PATH}`;
  console.log(`Generated ${GENERATED_PATH} (${operations.length} operations)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
