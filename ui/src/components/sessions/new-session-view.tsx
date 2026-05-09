/**
 * Sessions surface (Phase 4 ≥1.76.0) — new-session view rendered inside the
 * <SessionsShell> when the user is at `/sessions` (no active session). Same
 * layout as the detail page (header strip + empty timeline area + composer
 * pinned to the bottom) — submitting the composer creates a root task and
 * navigates to `/sessions/{newId}`.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Send } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/contexts/current-user-context";

export function NewSessionView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId } = useCurrentUser();
  const [draft, setDraft] = useState("");

  const create = useMutation({
    mutationFn: (input: { task: string; requestedByUserId?: string }) =>
      api.createTask({ task: input.task, requestedByUserId: input.requestedByUserId }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      navigate(`/sessions/${created.id}`);
    },
  });

  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || create.isPending) return;
    create.mutate({ task: trimmed, requestedByUserId: userId ?? undefined });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      {/* Header strip — two rows of h-12 so dividers align with the sidebar. */}
      <div className="flex flex-col min-w-0 shrink-0">
        <div className="flex items-center border-b border-border px-4 h-12 min-w-0">
          <h2 className="text-sm font-semibold">New session</h2>
        </div>
        <div className="flex items-center border-b border-border px-4 h-12 text-xs text-muted-foreground min-w-0">
          <span className="truncate">
            Type the first message below — it becomes the session's root task.
          </span>
        </div>
      </div>

      {/* Empty timeline area. */}
      <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
        <EmptyState
          icon={MessageSquarePlus}
          title="No messages yet"
          description="Describe what you want done. The lead picks it up and chains follow-up tasks under this root."
        />
      </div>

      {/* Composer pinned to bottom — same shape as <SessionComposer>. */}
      <form
        className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-card p-3 shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            userId
              ? "What's the goal? (⌘↵ to send)"
              : "Pick an identity in the sidebar before starting a session."
          }
          disabled={!userId || create.isPending}
          rows={3}
          className="min-h-[72px] max-h-[200px] resize-none overflow-y-auto"
          autoFocus
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {create.isPending ? "Starting…" : "⌘↵ to send"}
          </span>
          <Button
            type="submit"
            size="sm"
            disabled={!userId || draft.trim().length === 0 || create.isPending}
          >
            <Send className="h-3.5 w-3.5" />
            Start session
          </Button>
        </div>
        {create.isError && (
          <p className="text-xs text-status-error-strong">
            {create.error instanceof Error ? create.error.message : "Failed to create session"}
          </p>
        )}
      </form>
    </>
  );
}
