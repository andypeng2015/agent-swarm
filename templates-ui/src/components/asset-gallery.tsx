"use client";

import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssetCard } from "./asset-card";
import type { AgentAssetConfig, AgentAssetKind } from "../../../templates/schema";

interface AssetGalleryProps {
  assets: AgentAssetConfig[];
}

const kindFilters: Array<"All" | AgentAssetKind> = ["All", "skill", "schedule", "workflow"];
const kindLabels: Record<"All" | AgentAssetKind, string> = {
  All: "All",
  skill: "Skills",
  schedule: "Schedules",
  workflow: "Workflows",
};

export function AssetGallery({ assets }: AssetGalleryProps) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"All" | AgentAssetKind>("All");

  const fuse = useMemo(
    () =>
      new Fuse(assets, {
        keys: ["name", "displayName", "description", "tags"],
        threshold: 0.4,
      }),
    [assets],
  );

  const filtered = useMemo(() => {
    let results = query ? fuse.search(query).map((r) => r.item) : [...assets];

    if (kindFilter !== "All") {
      results = results.filter((a) => a.kind === kindFilter);
    }

    results.sort((a, b) => {
      const kindOrder: Record<AgentAssetKind, number> = { skill: 0, schedule: 1, workflow: 2 };
      return kindOrder[a.kind] - kindOrder[b.kind] || a.displayName.localeCompare(b.displayName);
    });

    return results;
  }, [query, kindFilter, assets, fuse]);

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search skills, schedules, workflows..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Kind filters */}
      <div className="flex flex-wrap gap-1.5">
        {kindFilters.map((f) => (
          <Badge
            key={f}
            variant={kindFilter === f ? "default" : "outline"}
            className="cursor-pointer capitalize"
            onClick={() => setKindFilter(f)}
          >
            {kindLabels[f]}
          </Badge>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((asset) => (
          <AssetCard key={`${asset.category}/${asset.name}`} asset={asset} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-muted-foreground">No templates match your filters.</p>
      )}
    </div>
  );
}
