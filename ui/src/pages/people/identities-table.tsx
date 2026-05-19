import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAddUserIdentity, useRemoveUserIdentity, useUpdateUser } from "@/api/hooks/use-users";
import type { User, UserIdentity } from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelative } from "@/lib/relative-time";
import { getIntegrationLabel, IntegrationIcon } from "./integration-icons";

const KIND_OPTIONS = ["slack", "linear", "github", "gitlab", "jira", "agentmail", "custom"];

type RowKind = "identity" | "alias";

interface IdentityRow {
  rowKind: RowKind;
  kind: string;
  externalId: string;
  /** Optional display name (alias has none; identity may have one in metadata). */
  displayName?: string;
  /** Backing identity reference (only present for `rowKind === "identity"`). */
  identity?: UserIdentity;
  /** ISO timestamp used for "Linked at". */
  linkedAt: string;
}

/**
 * Compose rows for the identities table:
 *   - One row per linked identity (kind / externalId / linkedAt)
 *   - One row per email alias (kind = "email-alias")
 *
 * The wire shape for `UserIdentity` doesn't carry a per-identity timestamp or
 * displayName yet, so we honestly surface the user's `lastUpdatedAt` for both
 * (matches the same compromise documented in the redesign plan).
 */
function composeRows(user: User): IdentityRow[] {
  const linkedAt = user.lastUpdatedAt;
  const idRows: IdentityRow[] = (user.identities ?? []).map((i) => ({
    rowKind: "identity" as const,
    kind: i.kind,
    externalId: i.externalId,
    identity: i,
    linkedAt,
  }));
  const aliasRows: IdentityRow[] = (user.emailAliases ?? []).map((alias) => ({
    rowKind: "alias" as const,
    kind: "email-alias",
    externalId: alias,
    linkedAt,
  }));
  return [...idRows, ...aliasRows];
}

function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Copy failed"),
  );
}

export function IdentitiesTable({ user }: { user: User }) {
  const addIdent = useAddUserIdentity();
  const removeIdent = useRemoveUserIdentity();
  const updateUser = useUpdateUser();

  const [addOpen, setAddOpen] = useState(false);
  const [draftKind, setDraftKind] = useState("slack");
  const [draftId, setDraftId] = useState("");

  const [pendingDelete, setPendingDelete] = useState<IdentityRow | null>(null);

  const rows = composeRows(user);

  async function add() {
    const id = draftId.trim();
    if (!id) return;
    try {
      await addIdent.mutateAsync({ id: user.id, identity: { kind: draftKind, externalId: id } });
      toast.success(`Linked ${getIntegrationLabel(draftKind)}: ${id}`);
      setDraftId("");
      setAddOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to link identity");
    }
  }

  async function confirmDelete() {
    const row = pendingDelete;
    if (!row) return;
    try {
      if (row.rowKind === "alias") {
        const next = (user.emailAliases ?? []).filter((a) => a !== row.externalId);
        await updateUser.mutateAsync({ id: user.id, data: { emailAliases: next } });
        toast.success("Alias removed");
      } else {
        await removeIdent.mutateAsync({
          id: user.id,
          kind: row.kind,
          externalId: row.externalId,
        });
        toast.success("Identity removed");
      }
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">No identities or email aliases linked yet.</p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add identity
        </Button>
        <AddIdentityDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          draftKind={draftKind}
          setDraftKind={setDraftKind}
          draftId={draftId}
          setDraftId={setDraftId}
          onSubmit={add}
          pending={addIdent.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "entry" : "entries"} — {user.identities?.length ?? 0}{" "}
          platform {(user.identities?.length ?? 0) === 1 ? "identity" : "identities"},{" "}
          {user.emailAliases?.length ?? 0} email{" "}
          {(user.emailAliases?.length ?? 0) === 1 ? "alias" : "aliases"}.
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add identity
        </Button>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Provider</TableHead>
              <TableHead>External ID</TableHead>
              <TableHead className="w-[140px]">Display name</TableHead>
              <TableHead className="w-[140px]">Linked at</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.kind}:${row.externalId}`}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <IntegrationIcon kind={row.kind} className="h-5 w-5 text-foreground/80" />
                    <span className="font-medium text-sm">{getIntegrationLabel(row.kind)}</span>
                    {row.rowKind === "alias" && (
                      <Badge variant="outline" size="tag" className="ml-1 normal-case">
                        Alias
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="group inline-flex items-center gap-1.5 font-mono text-xs hover:text-foreground text-foreground/80"
                    onClick={() => copyText(row.externalId)}
                    title="Click to copy"
                  >
                    <span className="truncate max-w-[28ch]">{row.externalId}</span>
                    <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
                  </button>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {row.displayName ?? <span className="text-muted-foreground/50">—</span>}
                  </span>
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground">
                        {formatRelative(row.linkedAt)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="font-mono text-[10px]">
                      {row.linkedAt}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="destructive-outline"
                    className="h-7 w-7"
                    onClick={() => setPendingDelete(row)}
                    aria-label={row.rowKind === "alias" ? "Remove alias" : "Remove identity"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddIdentityDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        draftKind={draftKind}
        setDraftKind={setDraftKind}
        draftId={draftId}
        setDraftId={setDraftId}
        onSubmit={add}
        pending={addIdent.isPending}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingDelete?.rowKind === "alias" ? "email alias" : "identity"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.rowKind === "alias" ? (
                <>
                  Remove <span className="font-mono">{pendingDelete.externalId}</span> from this
                  user's email aliases? They'll no longer auto-resolve to this account.
                </>
              ) : (
                <>
                  Unlink <span className="font-mono">{pendingDelete?.externalId}</span> from{" "}
                  <span className="font-medium">
                    {getIntegrationLabel(pendingDelete?.kind ?? "")}
                  </span>
                  ? Future events from this identity will land in the Unmapped queue.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddIdentityDialog({
  open,
  onOpenChange,
  draftKind,
  setDraftKind,
  draftId,
  setDraftId,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draftKind: string;
  setDraftKind: (kind: string) => void;
  draftId: string;
  setDraftId: (id: string) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add identity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={draftKind} onValueChange={setDraftKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((k) => (
                  <SelectItem key={k} value={k}>
                    <div className="flex items-center gap-2">
                      <IntegrationIcon kind={k} className="h-4 w-4 text-foreground/80" />
                      <span>{getIntegrationLabel(k)}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ident-external-id">External ID</Label>
            <Input
              id="ident-external-id"
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              placeholder="U12345…"
              className="font-mono"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!draftId.trim() || pending}>
            {pending ? "Linking…" : "Link identity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
