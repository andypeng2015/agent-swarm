"use client";

import { useState } from "react";
import { Check, Copy, Calendar, GitBranch, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AgentAssetResponse, AgentAssetKind } from "../../../templates/schema";

const kindIcons = {
  skill: Wrench,
  schedule: Calendar,
  workflow: GitBranch,
} satisfies Record<AgentAssetKind, React.ComponentType<{ className?: string }>>;

const kindLabels: Record<AgentAssetKind, string> = {
  skill: "Skill",
  schedule: "Schedule",
  workflow: "Workflow",
};

function buildPromptForLead(asset: AgentAssetResponse["config"], pageUrl: string): string {
  const { kind, displayName, slug, placeholders } = asset;
  const placeholderNote =
    placeholders.length > 0
      ? `\nReplace these placeholders before installing: ${placeholders.join(", ")}.`
      : "";

  if (kind === "skill") {
    return `Install the "${displayName}" skill from the templates registry.\n\nReference: ${pageUrl}${placeholderNote}\n\nOnce installed, worker agents can invoke it during tasks.`;
  }

  if (kind === "schedule") {
    return `Create a new schedule using the "${displayName}" template.\n\nReference: ${pageUrl}${placeholderNote}\n\nCopy the JSON payload from the template, fill in the placeholders, and run:\ncreate-schedule --from-template ${slug}`;
  }

  return `Create a workflow using the "${displayName}" template.\n\nReference: ${pageUrl}${placeholderNote}\n\nCopy the workflow JSON from the template and run:\ncreate-workflow --from-template ${slug}`;
}

interface AssetDetailProps {
  asset: AgentAssetResponse;
  category: string;
  name: string;
}

export function AssetDetail({ asset, category, name }: AssetDetailProps) {
  const [copied, setCopied] = useState(false);
  const pageUrl = `https://templates.agent-swarm.dev/${category}/${name}`;
  const promptText = buildPromptForLead(asset.config, pageUrl);
  const Icon = kindIcons[asset.config.kind];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">{asset.config.displayName}</h1>
          <Badge variant="secondary">{kindLabels[asset.config.kind]}</Badge>
          <Badge variant="outline">v{asset.config.version}</Badge>
        </div>
        <p className="text-lg text-muted-foreground mb-4">{asset.config.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {asset.config.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        {asset.config.placeholders.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 items-center text-sm text-muted-foreground">
            <span>Placeholders to fill:</span>
            {asset.config.placeholders.map((p) => (
              <code key={p} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {`{{${p}}}`}
              </code>
            ))}
          </div>
        )}
      </div>

      {/* Prompt for Lead */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold mb-1">Prompt for the Lead</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Copy this instruction and hand it to your Lead agent to install or create this{" "}
          {kindLabels[asset.config.kind].toLowerCase()}.
        </p>
        <div className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
          {promptText}
        </div>
        <button
          onClick={handleCopy}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy prompt"}
        </button>
      </div>

      {/* Content */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Template Content</h2>
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border bg-card/50 p-6">
          <MarkdownBody content={asset.body} />
        </div>
      </div>
    </div>
  );
}

function MarkdownBody({ content }: { content: string }) {
  // Simple markdown renderer: code fences and paragraphs
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="rounded-md bg-muted p-4 overflow-x-auto">
          <code className={lang ? `language-${lang}` : ""}>
            {codeLines.join("\n")}
          </code>
        </pre>,
      );
      i++;
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} className="text-xl font-bold mt-6 mb-2">
          {line.slice(2)}
        </h1>,
      );
      i++;
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="text-lg font-semibold mt-5 mb-2">
          {line.slice(3)}
        </h2>,
      );
      i++;
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="text-base font-semibold mt-4 mb-1">
          {line.slice(4)}
        </h3>,
      );
      i++;
    } else if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="list-decimal list-inside space-y-1 my-2 text-sm">
          {items.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          ))}
        </ol>,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-1 my-2 text-sm">
          {items.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          ))}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      elements.push(
        <p
          key={i}
          className="my-2 text-sm"
          dangerouslySetInnerHTML={{ __html: renderInline(line) }}
        />,
      );
      i++;
    }
  }

  return <>{elements}</>;
}

function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code class=\"rounded bg-muted px-1 py-0.5 text-xs font-mono\">$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
