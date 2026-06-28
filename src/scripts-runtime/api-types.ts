export type ScriptApiOperationDescriptor = {
  name: string;
  method: string;
  path: string;
  parameters: Array<{ name: string; in: "path" | "query" | "header"; required: boolean }>;
  hasBody: boolean;
  successStatus: string;
  requestType: string;
  responseType: string;
};

export type ScriptApiConnectionDescriptor = {
  slug: string;
  baseUrl: string;
  credential: {
    configKey: string;
    headerTemplate?: string;
    queryTemplate?: string;
  } | null;
  operations: ScriptApiOperationDescriptor[];
};
