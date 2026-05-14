"use client";

import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { getSiteName } from "@/lib/sites";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MetaRewrite, MetaRewriteForm } from "./app/approval";

import { proxyFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────
interface Approval {
  id: string;
  site_id: number;
  module: string;
  type: string;
  priority: number;
  title: string;
  original_content: Record<string, any>;
  updated_content: Record<string, any>;
  preview_url?: string;
  status: "pending" | "approved" | "rejected" | "deferred";
  created_at: string;
}

const REJECT_REASONS = [
  "Tone doesn't match brand voice",
  "Factually incorrect",
  "Too promotional",
  "Duplicate content",
  "Off-topic",
  "Other",
];

const PRIORITY_MAP: Record<
  number,
  {
    label: string;
    variant: "destructive" | "default" | "secondary" | "outline";
  }
> = {
  1: { label: "Critical", variant: "destructive" },
  2: { label: "High", variant: "default" },
  3: { label: "Medium", variant: "secondary" },
};

// ── Edit & Approve Modal ──────────────────────────────────────────────
function EditApproveDialog({
  approval,
  open,
  onClose,
  onApprove,
}: {
  approval: Approval;
  open: boolean;
  onClose: () => void;
  onApprove: (content: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(
    approval.updated_content?.suggested_title ||
      approval.original_content.suggested_title,
  );
  const [description, setDescription] = useState(
    approval.updated_content?.suggested_description ||
      approval.original_content.suggested_description,
  );

  const reasoning =
    approval.updated_content?.reasoning || approval.original_content.reasoning;

  function handleApprove() {
    try {
      const payload = {
        ...approval.updated_content,
        suggested_title: title,
        suggested_description: description,
      };

      onApprove(payload);
    } catch (err) {
      console.log("Approval Error : ", err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-9/10 max-w-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit &amp; Approve</DialogTitle>
          <p className="text-sm text-muted-foreground">{approval.title}</p>
        </DialogHeader>
        <ScrollArea className="max-h-[500] px-1 -mx-2 pe-4">
          {approval.type === "meta_rewrite" && (
            <MetaRewriteForm
              title={title}
              setTitle={setTitle}
              description={description}
              setDescription={setDescription}
              reasoning={reasoning}
            />
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleApprove}>
            Approve with edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Modal ──────────────────────────────────────────────────────
function RejectDialog({
  approval,
  open,
  onClose,
  onReject,
}: {
  approval: Approval;
  open: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject Approval</DialogTitle>
          <p className="text-sm text-muted-foreground">{approval.title}</p>
        </DialogHeader>

        <Select
          onValueChange={(v: string | null) => {
            if (v) setReason(v);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a reason…" />
          </SelectTrigger>
          <SelectContent>
            {REJECT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason}
            onClick={() => reason && onReject(reason)}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Approval Card ─────────────────────────────────────────────────────
function ApprovalCard({
  approval,
  onAction,
}: {
  approval: Approval;
  onAction: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const priority = PRIORITY_MAP[approval.priority] ?? PRIORITY_MAP[3];

  async function doApprove(content?: Record<string, unknown>) {
    setLoading(true);
    await proxyFetch(`/api/approvals/${approval.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(content ? { content } : {}),
      }),
    });
    setLoading(false);
    setEditOpen(false);
    onAction();
  }

  async function doReject(reason: string) {
    setLoading(true);
    await proxyFetch(`/api/approvals/${approval.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setLoading(false);
    setRejectOpen(false);
    onAction();
  }

  async function doDefer() {
    setLoading(true);
    await proxyFetch(`/api/approvals/${approval.id}/defer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    setLoading(false);
    onAction();
  }

  const previewOriginalText = approval.original_content;
  const previewUpdatedText = approval.updated_content;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={priority.variant}>{priority.label}</Badge>
            <Badge variant="outline">{approval.module}</Badge>
            <Badge variant="secondary">{approval.type}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {getSiteName(approval.site_id)} ·{" "}
              {new Date(approval.created_at).toLocaleDateString()}
            </span>
          </div>
          <CardTitle className="mt-1 text-base">{approval.title}</CardTitle>
        </CardHeader>

        <CardContent>
          {approval.type === "meta_rewrite" && (
            <MetaRewrite
              original_content={previewOriginalText}
              updated_content={previewUpdatedText}
            />
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap gap-2 py-2">
          <Button
            size="sm"
            disabled={loading}
            onClick={() => doApprove()}
            className="bg-green-600 hover:bg-green-700"
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => setEditOpen(true)}
          >
            Edit &amp; Approve
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={loading}
            onClick={() => setRejectOpen(true)}
          >
            Reject
          </Button>
          {/* <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={doDefer}
          >
            Defer
          </Button> */}
        </CardFooter>
      </Card>

      <EditApproveDialog
        approval={approval}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onApprove={doApprove}
      />
      <RejectDialog
        approval={approval}
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        onReject={doReject}
      />
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────
export default function ApprovalQueue({
  onCountChange,
}: {
  onCountChange?: (n: number) => void;
}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await proxyFetch(
        `/api/approvals?status=pending&sort=priority`,
      );
      const data = (await res.json()) as { approvals: Approval[] };
      setApprovals(data.approvals ?? []);
      onCountChange?.(data.approvals?.length ?? 0);
    } catch {
      // keep current state on network error
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void fetchApprovals();

    const socket = getSocket();
    socket.on("approval:created", () => void fetchApprovals());
    socket.on("approval:updated", () => void fetchApprovals());

    return () => {
      socket.off("approval:created");
      socket.off("approval:updated");
    };
  }, [fetchApprovals]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Loading approvals…
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className="text-3xl">✓</span>
        <p>No pending approvals — all clear!</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-12rem)]">
      <div className="space-y-3 p-1 pr-4">
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            onAction={fetchApprovals}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
