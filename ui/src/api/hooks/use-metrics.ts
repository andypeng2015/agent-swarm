import { useQuery } from "@tanstack/react-query";
import { api } from "../client";

/**
 * Swarm-wide COUNT(*) metrics from `GET /api/metrics`.
 *
 * Graceful degradation: `api.fetchMetrics()` returns `null` for any non-2xx
 * response — older API servers predate this route and 404. Consumers (the
 * sidebar indicators) treat `null`/`undefined` as "no data" and render
 * nothing, so the query never throws and never surfaces an error state.
 *
 * 5s polling matches the default list-hook cadence; the payload is a handful
 * of cheap counts so the cost is negligible.
 */
export function useMetrics() {
  return useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.fetchMetrics(),
    refetchInterval: 5000,
    // Never noisy-retry against an API server that simply lacks the route.
    retry: false,
  });
}
