/**
 * Sessions surface (Phase 4 ≥1.76.0) — react-query bindings for the new
 * `/api/sessions` endpoints.
 *
 * - `useSessions()` powers the `/sessions` sidebar list (root-task chains
 *   ordered by chain-wide last activity).
 * - `useSession(rootTaskId)` returns the full chain payload for the selected
 *   session (single round trip; the server already orders by `createdAt`).
 *
 * Soft-degrade: callers must wrap usage in `useFeatureGate("1.76.0")` so older
 * API servers (which 404 these endpoints) don't render the Sessions surface.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../client";

export interface UseSessionsOptions {
  limit?: number;
  offset?: number;
}

export function useSessions(options?: UseSessionsOptions) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset;
  return useQuery({
    queryKey: ["sessions", { limit, offset }],
    queryFn: () => api.listSessions({ limit, offset }),
  });
}

export function useSession(rootTaskId: string | undefined) {
  return useQuery({
    queryKey: ["session", rootTaskId],
    queryFn: () => api.getSession(rootTaskId!),
    enabled: !!rootTaskId,
  });
}
