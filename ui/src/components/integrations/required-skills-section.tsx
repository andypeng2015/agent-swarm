import { Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentRole, RequiredSkill } from "@/lib/integrations-catalog";

interface RequiredSkillsSectionProps {
  /** Skills the integration needs installed on the swarm to function end-to-end. */
  requiredSkills: RequiredSkill[];
}

/**
 * Renders the "Required skills" section under an integration's env-var inputs.
 *
 * Some integrations need procedural knowledge (a skill) installed on a specific
 * agent role for the env-var configuration to do something useful. This
 * section surfaces that gap so operators don't silently end up with a
 * half-wired integration.
 *
 * The "Install on <role>" button is a placeholder for this PR — clicking it
 * does nothing. See TODO below for the follow-up that wires the actual install
 * API. Until then the operator installs from /settings/skills.
 */
export function RequiredSkillsSection({ requiredSkills }: RequiredSkillsSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
          Required skills
        </h2>
        <Badge variant="outline" size="tag">
          {requiredSkills.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Setting the env-vars above is not always enough — these skills also need to be installed on
        the listed agent role(s) for the integration to function end-to-end.
      </p>
      <ul className="space-y-2">
        {requiredSkills.map((rs) => (
          <RequiredSkillRow key={rs.skill} required={rs} />
        ))}
      </ul>
    </section>
  );
}

interface RequiredSkillRowProps {
  required: RequiredSkill;
}

function RequiredSkillRow({ required }: RequiredSkillRowProps) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-xs text-foreground">{required.skill}</code>
          {required.roles.map((role) => (
            <Badge key={role} variant="outline" size="tag">
              {role}
            </Badge>
          ))}
        </div>
        {required.reason && (
          <p className="text-xs text-muted-foreground leading-snug">{required.reason}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {required.roles.map((role) => (
          <InstallOnRoleButton key={role} role={role} skillName={required.skill} />
        ))}
      </div>
    </li>
  );
}

interface InstallOnRoleButtonProps {
  role: AgentRole;
  skillName: string;
}

/**
 * TODO(integrations-ui): wire up real one-click install via
 * `useInstallSkill({ skillId, agentId })` once we settle on a skill-picker
 * UX for "Install on <role>". Until then this button is render-only and
 * the operator installs from /settings/skills.
 *
 * Future work also needs to detect the per-agent-role installation state
 * (call `/api/agents/{id}/skills` for each matching agent) and render a
 * green "Installed on <role>" instead of the install CTA when present.
 */
function InstallOnRoleButton({ role, skillName }: InstallOnRoleButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            className="gap-1 pointer-events-none"
            aria-label={`Install ${skillName} on ${role} (coming soon)`}
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Install on {role}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Coming soon: one-click install from this page. For now, install the skill from{" "}
        <code className="font-mono">/settings/skills</code> onto a {role} agent.
      </TooltipContent>
    </Tooltip>
  );
}
