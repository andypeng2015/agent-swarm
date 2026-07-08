import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OAuthAppSummary,
  ScriptConnectionKind,
  ScriptConnectionScope,
  ScriptCredentialBinding,
  UpsertCredentialBindingInput,
  UpsertOAuthAppInput,
  UpsertScriptConnectionInput,
} from "@/api/types";
import { api } from "../client";

export interface ScriptConnectionFilters {
  kind?: ScriptConnectionKind | "all";
  scope?: ScriptConnectionScope | "all";
  scopeId?: string;
}

export function useScriptConnections(filters?: ScriptConnectionFilters) {
  return useQuery({
    queryKey: ["script-connections", filters],
    queryFn: () => api.fetchScriptConnections(filters),
    select: (data) => data.connections,
  });
}

export function useCredentialBindings() {
  return useQuery({
    queryKey: ["credential-bindings"],
    queryFn: () => api.fetchCredentialBindings(),
    select: (data) => data.bindings as ScriptCredentialBinding[],
  });
}

export function useOAuthApps() {
  return useQuery({
    queryKey: ["oauth-apps"],
    queryFn: () => api.fetchOAuthApps(),
    select: (data) => data.oauthApps as OAuthAppSummary[],
  });
}

export function useUpsertScriptConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertScriptConnectionInput) => api.upsertScriptConnection(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["script-connections"] });
      queryClient.invalidateQueries({ queryKey: ["credential-bindings"] });
      queryClient.invalidateQueries({ queryKey: ["script-type-defs"] });
    },
  });
}

export function useRefreshScriptConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.refreshScriptConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["script-connections"] });
      queryClient.invalidateQueries({ queryKey: ["script-type-defs"] });
    },
  });
}

export function useSetScriptConnectionEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setScriptConnectionEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["script-connections"] });
      queryClient.invalidateQueries({ queryKey: ["script-type-defs"] });
    },
  });
}

export function useUpsertCredentialBinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertCredentialBindingInput) => api.upsertCredentialBinding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credential-bindings"] });
      queryClient.invalidateQueries({ queryKey: ["script-connections"] });
    },
  });
}

export function useUpsertOAuthApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpsertOAuthAppInput) => api.upsertOAuthApp(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oauth-apps"] });
      queryClient.invalidateQueries({ queryKey: ["credential-bindings"] });
      queryClient.invalidateQueries({ queryKey: ["script-connections"] });
    },
  });
}

export function useOAuthAuthorizeUrl() {
  return useMutation({
    mutationFn: (provider: string) => api.fetchOAuthAuthorizeUrl(provider),
  });
}

export function useRunInlineScript() {
  return useMutation({
    mutationFn: (data: { source: string; intent: string; agentId: string }) =>
      api.runInlineScript(data),
  });
}
