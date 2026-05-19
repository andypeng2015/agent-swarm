import type { UserIdentity } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getIntegrationLabel, IntegrationIcon } from "./integration-icons";

/**
 * Chip-style identity badge — used in places where a dense table would be
 * overkill (merge modal "moving X identities" preview, unmapped triage rows).
 *
 * For the People detail page's primary identity surface use `IdentitiesTable`
 * (./identities-table.tsx) instead; that's the canonical operator view.
 */
export function IdentityBadge({
  identity,
  showId = false,
}: {
  identity: UserIdentity;
  showId?: boolean;
}) {
  const label = getIntegrationLabel(identity.kind);
  const idTrunc =
    identity.externalId.length > 14 ? `${identity.externalId.slice(0, 12)}…` : identity.externalId;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1.5 normal-case font-medium text-[10px] px-1.5 py-0 h-5 leading-none items-center",
          )}
        >
          <IntegrationIcon kind={identity.kind} className="h-3 w-3 text-foreground/70" />
          <span>{label}</span>
          {showId && (
            <span className="font-mono text-muted-foreground border-l border-border/60 pl-1.5">
              {idTrunc}
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="font-mono text-xs">
        {label} · {identity.externalId}
      </TooltipContent>
    </Tooltip>
  );
}

export function IdentityBadgeList({
  identities,
  showId = false,
}: {
  identities: UserIdentity[] | undefined;
  showId?: boolean;
}) {
  if (!identities || identities.length === 0) {
    return <span className="text-xs italic text-muted-foreground/50">No identities</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {identities.map((i) => (
        <IdentityBadge key={`${i.kind}:${i.externalId}`} identity={i} showId={showId} />
      ))}
    </div>
  );
}
