import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { KeyRound, Link2, Play, Plus, RefreshCw, SquareCode } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/api/hooks/use-agents";
import { useMcpServers } from "@/api/hooks/use-mcp-servers";
import {
  useCredentialBindings,
  useOAuthApps,
  useOAuthAuthorizeUrl,
  useRefreshScriptConnection,
  useRunInlineScript,
  useScriptConnections,
  useSetScriptConnectionEnabled,
  useUpsertOAuthApp,
  useUpsertScriptConnection,
} from "@/api/hooks/use-script-connections";
import type {
  CredentialAuthKind,
  OAuthAppSummary,
  OAuthBindingTokenStatus,
  ScriptConnection,
  ScriptConnectionKind,
  ScriptConnectionScope,
  ScriptCredentialBinding,
} from "@/api/types";
import { DataGrid } from "@/components/shared/data-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { readStringParam, useUrlSearchState } from "@/hooks/use-url-search-state";
import { cn, formatSmartTime } from "@/lib/utils";

const KIND_OPTIONS: Array<ScriptConnectionKind | "all"> = ["all", "openapi", "graphql", "mcp"];
const SCOPE_OPTIONS: Array<ScriptConnectionScope | "all"> = ["all", "global", "agent", "repo"];
const PLAYGROUND_SOURCE = `export default async function(args, ctx) {
  return { api: Object.keys(ctx.api ?? {}), mcp: Object.keys(ctx.mcp ?? {}) };
}`;

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function configPlaceholder(configKey: string): string {
  return configKey ? `[REDACTED:${configKey}]` : "[REDACTED:CONFIGKEY]";
}

function defaultHeaderTemplate(configKey: string): string {
  return `Authorization: Bearer ${configPlaceholder(configKey)}`;
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function KindBadge({ kind }: { kind: ScriptConnectionKind }) {
  const colors: Record<ScriptConnectionKind, string> = {
    openapi: "border-action-default/30 text-action-default",
    graphql: "border-action-script/30 text-action-script",
    mcp: "border-action-delegate-to-agent/30 text-action-delegate-to-agent",
  };
  return (
    <Badge variant="outline" size="tag" className={colors[kind]}>
      {kind}
    </Badge>
  );
}

function TokenStatusBadge({ status }: { status?: OAuthBindingTokenStatus }) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const colors: Record<OAuthBindingTokenStatus, string> = {
    ok: "border-status-success/30 text-status-success",
    expiring: "border-status-active/30 text-status-active",
    missing: "border-status-error/30 text-status-error",
  };
  return (
    <Badge variant="outline" size="tag" className={colors[status]}>
      {status}
    </Badge>
  );
}

function CredentialChip({ connection }: { connection: ScriptConnection }) {
  const binding = connection.credentialBinding;
  if (!binding) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <Badge variant="outline" size="tag">
        {binding.authKind}
      </Badge>
      <span className="truncate">{binding.configKey}</span>
      {binding.oauthProvider ? (
        <span className="truncate text-muted-foreground">({binding.oauthProvider})</span>
      ) : null}
      <TokenStatusBadge status={binding.tokenStatus} />
    </span>
  );
}

function InlineError({ error }: { error?: unknown }) {
  if (!error) return null;
  return (
    <p className="text-sm text-status-error">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

function AddConnectionDialog({
  open,
  onOpenChange,
  bindings,
  oauthApps,
  mcpServers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bindings: ScriptCredentialBinding[];
  oauthApps: OAuthAppSummary[];
  mcpServers: Array<{ id: string; name: string }>;
}) {
  const upsert = useUpsertScriptConnection();
  const [kind, setKind] = useState<ScriptConnectionKind>("openapi");
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [allowedHosts, setAllowedHosts] = useState("");
  const [mcpServerId, setMcpServerId] = useState("");
  const [specMode, setSpecMode] = useState<"url" | "inline">("url");
  const [openapiSpecUrl, setOpenapiSpecUrl] = useState("");
  const [openapiSpecJson, setOpenapiSpecJson] = useState("");
  const [credentialMode, setCredentialMode] = useState<"none" | "existing" | "inline">("none");
  const [credentialBindingId, setCredentialBindingId] = useState("");
  const [configKey, setConfigKey] = useState("");
  const [headerTemplate, setHeaderTemplate] = useState(defaultHeaderTemplate(""));
  const [queryTemplate, setQueryTemplate] = useState("");
  const [authKind, setAuthKind] = useState<CredentialAuthKind>("config");
  const [oauthProvider, setOauthProvider] = useState("");
  const previousAutoHeader = useRef(defaultHeaderTemplate(""));

  useEffect(() => {
    const next = defaultHeaderTemplate(configKey);
    if (!headerTemplate || headerTemplate === previousAutoHeader.current) {
      setHeaderTemplate(next);
    }
    previousAutoHeader.current = next;
  }, [configKey, headerTemplate]);

  useEffect(() => {
    if (!open) {
      setKind("openapi");
      setSlug("");
      setDisplayName("");
      setBaseUrl("");
      setAllowedHosts("");
      setMcpServerId("");
      setSpecMode("url");
      setOpenapiSpecUrl("");
      setOpenapiSpecJson("");
      setCredentialMode("none");
      setCredentialBindingId("");
      setConfigKey("");
      setHeaderTemplate(defaultHeaderTemplate(""));
      setQueryTemplate("");
      setAuthKind("config");
      setOauthProvider("");
      previousAutoHeader.current = defaultHeaderTemplate("");
    }
  }, [open]);

  async function submit() {
    const parsedHosts = splitList(allowedHosts);
    const credential =
      credentialMode === "existing"
        ? { credentialBindingId: credentialBindingId || null }
        : credentialMode === "inline"
          ? {
              configKey,
              headerTemplate: optionalString(headerTemplate),
              queryTemplate: optionalString(queryTemplate),
              authKind,
              oauthProvider: authKind === "oauth" ? optionalString(oauthProvider) : undefined,
            }
          : {};
    const common = {
      slug,
      displayName: optionalString(displayName),
      allowedHosts: parsedHosts.length ? parsedHosts : undefined,
      ...credential,
    };

    if (kind === "mcp") {
      await upsert.mutateAsync({
        kind: "mcp",
        slug,
        displayName: optionalString(displayName),
        mcpServerId,
      });
    } else if (kind === "graphql") {
      await upsert.mutateAsync({
        ...common,
        kind: "graphql",
        baseUrl,
        allowedHosts: parsedHosts,
      });
    } else {
      await upsert.mutateAsync({
        ...common,
        kind: "openapi",
        baseUrl,
        ...(specMode === "url"
          ? { openapiSpecUrl: openapiSpecUrl.trim() }
          : { openapiSpecJson: openapiSpecJson.trim() }),
      });
    }
    onOpenChange(false);
  }

  const canSubmit =
    slug.trim() &&
    (kind === "mcp"
      ? mcpServerId
      : baseUrl.trim() &&
        (kind === "graphql" ||
          (specMode === "url" ? openapiSpecUrl.trim() : openapiSpecJson.trim()))) &&
    (credentialMode !== "existing" || credentialBindingId) &&
    (credentialMode !== "inline" ||
      (configKey.trim() && (authKind !== "oauth" || oauthProvider.trim())));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Connection</DialogTitle>
          <DialogDescription>Register an API or MCP namespace for scripts.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as ScriptConnectionKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openapi">OpenAPI</SelectItem>
                  <SelectItem value="graphql">GraphQL</SelectItem>
                  <SelectItem value="mcp">MCP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
          </div>

          {kind === "mcp" ? (
            <div className="space-y-2">
              <Label>MCP Server</Label>
              <Select value={mcpServerId} onValueChange={setMcpServerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select server" />
                </SelectTrigger>
                <SelectContent>
                  {mcpServers.map((server) => (
                    <SelectItem key={server.id} value={server.id}>
                      {server.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Allowed Hosts</Label>
                  <Input
                    value={allowedHosts}
                    onChange={(event) => setAllowedHosts(event.target.value)}
                    placeholder="api.example.com, uploads.example.com"
                  />
                </div>
              </div>

              {kind === "openapi" ? (
                <div className="grid gap-3">
                  <Select
                    value={specMode}
                    onValueChange={(value) => setSpecMode(value as "url" | "inline")}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="url">Spec URL</SelectItem>
                      <SelectItem value="inline">Inline JSON</SelectItem>
                    </SelectContent>
                  </Select>
                  {specMode === "url" ? (
                    <div className="space-y-2">
                      <Label>Spec URL</Label>
                      <Input
                        value={openapiSpecUrl}
                        onChange={(event) => setOpenapiSpecUrl(event.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Inline JSON</Label>
                      <Textarea
                        value={openapiSpecJson}
                        onChange={(event) => setOpenapiSpecJson(event.target.value)}
                        className="min-h-40 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {kind !== "mcp" ? (
            <div className="grid gap-4 rounded-md border p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Credential</Label>
                  <Select
                    value={credentialMode}
                    onValueChange={(value) =>
                      setCredentialMode(value as "none" | "existing" | "inline")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="existing">Existing</SelectItem>
                      <SelectItem value="inline">Create Inline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {credentialMode === "existing" ? (
                  <div className="space-y-2 md:col-span-2">
                    <Label>Binding</Label>
                    <Select value={credentialBindingId} onValueChange={setCredentialBindingId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select binding" />
                      </SelectTrigger>
                      <SelectContent>
                        {bindings.map((binding) => (
                          <SelectItem key={binding.id} value={binding.id}>
                            {binding.configKey} ({binding.authKind})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>

              {credentialMode === "inline" ? (
                <div className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Config Key</Label>
                      <Input
                        value={configKey}
                        onChange={(event) => setConfigKey(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Auth Kind</Label>
                      <Select
                        value={authKind}
                        onValueChange={(value) => setAuthKind(value as CredentialAuthKind)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="config">Config</SelectItem>
                          <SelectItem value="oauth">OAuth</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {authKind === "oauth" ? (
                      <div className="space-y-2">
                        <Label>OAuth Provider</Label>
                        <Input
                          value={oauthProvider}
                          onChange={(event) => setOauthProvider(event.target.value)}
                          list="oauth-provider-options"
                        />
                        <datalist id="oauth-provider-options">
                          {oauthApps.map((app) => (
                            <option key={app.provider} value={app.provider} />
                          ))}
                        </datalist>
                      </div>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Header Template</Label>
                      <Input
                        value={headerTemplate}
                        onChange={(event) => setHeaderTemplate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Query Template</Label>
                      <Input
                        value={queryTemplate}
                        onChange={(event) => setQueryTemplate(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <InlineError error={upsert.error} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || upsert.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OAuthAppsSection({ apps }: { apps: OAuthAppSummary[] }) {
  const [open, setOpen] = useState(false);
  const authorize = useOAuthAuthorizeUrl();

  async function openAuthorize(provider: string) {
    const result = await authorize.mutateAsync(provider);
    window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-muted-foreground" />
          OAuth Apps
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add OAuth App
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {apps.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No OAuth apps
          </div>
        ) : (
          <div className="grid gap-2">
            {apps.map((app) => (
              <div
                key={app.provider}
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(120px,1fr)_minmax(220px,2fr)_auto_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{app.provider}</div>
                  <div className="truncate text-xs text-muted-foreground">{app.clientId}</div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{app.redirectUri}</div>
                <TokenStatusBadge status={app.tokenStatus} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openAuthorize(app.provider)}
                  disabled={authorize.isPending}
                >
                  Authorize
                </Button>
              </div>
            ))}
          </div>
        )}
        <InlineError error={authorize.error} />
      </CardContent>
      <OAuthAppDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function OAuthAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upsert = useUpsertOAuthApp();
  const [provider, setProvider] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState("");
  const [tokenAuthStyle, setTokenAuthStyle] = useState<"body" | "basic">("body");
  const [tokenBodyFormat, setTokenBodyFormat] = useState<"form" | "json">("form");
  const [extraParams, setExtraParams] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    if (!open) {
      setProvider("");
      setClientId("");
      setClientSecret("");
      setAuthorizeUrl("");
      setTokenUrl("");
      setScopes("");
      setTokenAuthStyle("body");
      setTokenBodyFormat("form");
      setExtraParams([]);
    }
  }, [open]);

  async function submit() {
    await upsert.mutateAsync({
      provider,
      clientId,
      clientSecret,
      authorizeUrl,
      tokenUrl,
      scopes: splitList(scopes),
      tokenAuthStyle,
      tokenBodyFormat,
      extraParams: Object.fromEntries(
        extraParams
          .map((row) => [row.key.trim(), row.value.trim()] as const)
          .filter(([key]) => key),
      ),
    });
    onOpenChange(false);
  }

  const canSubmit =
    provider.trim() &&
    clientId.trim() &&
    clientSecret.trim() &&
    authorizeUrl.trim() &&
    tokenUrl.trim() &&
    splitList(scopes).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add OAuth App</DialogTitle>
          <DialogDescription>Client secrets are write-only.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input value={provider} onChange={(event) => setProvider(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input value={clientId} onChange={(event) => setClientId(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Authorize URL</Label>
              <Input
                value={authorizeUrl}
                onChange={(event) => setAuthorizeUrl(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Token URL</Label>
              <Input value={tokenUrl} onChange={(event) => setTokenUrl(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Scopes</Label>
            <Input value={scopes} onChange={(event) => setScopes(event.target.value)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Token Auth</Label>
              <Select
                value={tokenAuthStyle}
                onValueChange={(value) => setTokenAuthStyle(value as "body" | "basic")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="body">Body</SelectItem>
                  <SelectItem value="basic">Basic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Body Format</Label>
              <Select
                value={tokenBodyFormat}
                onValueChange={(value) => setTokenBodyFormat(value as "form" | "json")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="form">Form</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Extra Params</Label>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setExtraParams((rows) => [...rows, { key: "", value: "" }])}
              >
                Add Row
              </Button>
            </div>
            <div className="grid gap-2">
              {extraParams.map((row, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    value={row.key}
                    onChange={(event) =>
                      setExtraParams((rows) =>
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, key: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    value={row.value}
                    onChange={(event) =>
                      setExtraParams((rows) =>
                        rows.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      setExtraParams((rows) => rows.filter((_, itemIndex) => itemIndex !== index))
                    }
                    aria-label="Remove extra parameter"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <InlineError error={upsert.error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || upsert.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlaygroundPanel({ defaultAgentId }: { defaultAgentId?: string }) {
  const { data: agents } = useAgents(false);
  const run = useRunInlineScript();
  const [source, setSource] = useState(PLAYGROUND_SOURCE);
  const [agentId, setAgentId] = useState(defaultAgentId ?? "");

  useEffect(() => {
    if (!agentId && defaultAgentId) setAgentId(defaultAgentId);
  }, [agentId, defaultAgentId]);

  const result = run.data;
  return (
    <Card className="rounded-lg">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <SquareCode className="size-4 text-muted-foreground" />
          Playground
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Run as" />
            </SelectTrigger>
            <SelectContent>
              {(agents ?? []).map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={() => run.mutate({ source, intent: "connections playground", agentId })}
            disabled={!agentId || run.isPending}
          >
            <Play className="size-4" />
            Run
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="min-h-36 font-mono text-xs"
        />
        <InlineError error={run.error} />
        {result ? (
          <div className="grid gap-2 md:grid-cols-3">
            <pre className="min-h-24 overflow-auto rounded-md border bg-muted/40 p-3 text-xs md:col-span-2">
              {JSON.stringify(result.result ?? null, null, 2)}
            </pre>
            <div className="grid gap-2">
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground">Duration</div>
                <div className="font-medium">{result.durationMs ?? 0} ms</div>
              </div>
              <pre
                className={cn(
                  "min-h-16 overflow-auto rounded-md border p-3 text-xs",
                  result.stderr
                    ? "border-status-error/40 text-status-error"
                    : "text-muted-foreground",
                )}
              >
                {result.stderr || result.stdout || "No stdout"}
              </pre>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function ConnectionsPage() {
  const { searchParams, setParam } = useUrlSearchState();
  const search = readStringParam(searchParams, "search");
  const kindParam = readStringParam(searchParams, "kind", "all");
  const scopeParam = readStringParam(searchParams, "scope", "all");
  const kindFilter = KIND_OPTIONS.includes(kindParam as ScriptConnectionKind | "all")
    ? (kindParam as ScriptConnectionKind | "all")
    : "all";
  const scopeFilter = SCOPE_OPTIONS.includes(scopeParam as ScriptConnectionScope | "all")
    ? (scopeParam as ScriptConnectionScope | "all")
    : "all";
  const [addOpen, setAddOpen] = useState(false);

  const { data: connections, isLoading } = useScriptConnections({
    kind: kindFilter,
    scope: scopeFilter,
  });
  const { data: bindings = [] } = useCredentialBindings();
  const { data: oauthApps = [] } = useOAuthApps();
  const { data: mcpServersData } = useMcpServers();
  const { data: agents } = useAgents(false);
  const refreshConnection = useRefreshScriptConnection();
  const setEnabled = useSetScriptConnectionEnabled();
  const defaultAgentId = useMemo(
    () => agents?.find((agent) => agent.isLead)?.id ?? agents?.[0]?.id,
    [agents],
  );

  const columnDefs = useMemo<ColDef<ScriptConnection>[]>(
    () => [
      {
        field: "slug",
        headerName: "Slug",
        minWidth: 140,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) => (
          <span className="font-semibold">{params.value}</span>
        ),
      },
      {
        field: "kind",
        headerName: "Kind",
        width: 110,
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) =>
          params.value ? <KindBadge kind={params.value as ScriptConnectionKind} /> : null,
      },
      {
        headerName: "Target",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) => params.data?.baseUrl ?? params.data?.mcpServerId ?? "",
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) => (
          <span className="truncate text-muted-foreground">
            {params.data?.baseUrl ?? params.data?.mcpServerId ?? "—"}
          </span>
        ),
      },
      {
        headerName: "Ops",
        width: 90,
        valueGetter: (params) =>
          params.data
            ? params.data.kind === "mcp"
              ? params.data.toolCount
              : params.data.operationCount
            : 0,
      },
      {
        headerName: "Credential",
        minWidth: 240,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) =>
          params.data ? <CredentialChip connection={params.data} /> : null,
      },
      {
        field: "enabled",
        headerName: "Enabled",
        width: 105,
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) =>
          params.data ? (
            <span onClick={(event) => event.stopPropagation()}>
              <Switch
                size="sm"
                checked={params.data.enabled}
                onCheckedChange={(enabled) => setEnabled.mutate({ id: params.data!.id, enabled })}
                disabled={setEnabled.isPending}
              />
            </span>
          ) : null,
      },
      {
        headerName: "Refresh",
        width: 105,
        cellRenderer: (params: ICellRendererParams<ScriptConnection>) => {
          const canRefresh = params.data?.kind === "openapi" || params.data?.kind === "mcp";
          return params.data && canRefresh ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                refreshConnection.mutate(params.data!.id);
              }}
              disabled={refreshConnection.isPending}
            >
              <RefreshCw className="size-3" />
              Refresh
            </Button>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        field: "createdAt",
        headerName: "Created",
        width: 140,
        valueFormatter: (params) => (params.value ? formatSmartTime(params.value) : ""),
      },
      {
        field: "updatedAt",
        headerName: "Updated",
        width: 140,
        valueFormatter: (params) => (params.value ? formatSmartTime(params.value) : ""),
      },
    ],
    [refreshConnection, setEnabled],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      <PageHeader
        title="Connections"
        icon={Link2}
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add Connection
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <Input
          placeholder="Search connections..."
          value={search}
          onChange={(event) =>
            setParam("search", event.target.value, { reset: ["connectionsPage"] })
          }
          className="max-w-xs"
        />
        <Select
          value={kindFilter}
          onValueChange={(value) =>
            setParam("kind", value, { defaultValue: "all", reset: ["connectionsPage"] })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Kinds</SelectItem>
            <SelectItem value="openapi">OpenAPI</SelectItem>
            <SelectItem value="graphql">GraphQL</SelectItem>
            <SelectItem value="mcp">MCP</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={scopeFilter}
          onValueChange={(value) =>
            setParam("scope", value, { defaultValue: "all", reset: ["connectionsPage"] })
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scopes</SelectItem>
            <SelectItem value="global">Global</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="repo">Repo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="connections" className="flex flex-col flex-1 min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="oauth">OAuth Apps</TabsTrigger>
          <TabsTrigger value="playground">Playground</TabsTrigger>
        </TabsList>
        <TabsContent value="connections" className="flex flex-col flex-1 min-h-0 mt-3">
          <DataGrid
            rowData={connections ?? []}
            columnDefs={columnDefs}
            quickFilterText={search}
            loading={isLoading}
            emptyMessage="No script connections found"
            paginationQueryKey="connections"
          />
          <InlineError error={refreshConnection.error ?? setEnabled.error} />
        </TabsContent>
        <TabsContent value="oauth" className="mt-3">
          <OAuthAppsSection apps={oauthApps} />
        </TabsContent>
        <TabsContent value="playground" className="mt-3">
          <PlaygroundPanel defaultAgentId={defaultAgentId} />
        </TabsContent>
      </Tabs>

      <AddConnectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        bindings={bindings}
        oauthApps={oauthApps}
        mcpServers={(mcpServersData?.servers ?? []).map((server) => ({
          id: server.id,
          name: server.name,
        }))}
      />
    </div>
  );
}
