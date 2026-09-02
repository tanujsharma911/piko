import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Check,
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export interface AuditEntry {
  message: string;
  toolName?: string;
  status: "pending" | "done" | "error" | "warning";
  kind?: string;
  reason?: string;
  orderId?: string;
  via?: string;
  amount?: number;
  source?: string;
  expected?: number;
  actual?: number;
}

const KIND_LABELS: Record<string, string> = {
  payment_created: "Payment created",
  payment_reused: "Payment reused",
  payment_rejected: "Payment rejected",
  payment_verified: "Payment verified",
  placement_mismatch: "Price mismatch",
};

const MessageText = ({
  message,
  toolName,
}: {
  message: string;
  toolName?: string;
}) => {
  if (!toolName) return <span className="min-w-0 break-words">{message}</span>;

  const idx = message.indexOf(toolName);
  if (idx === -1) return <span className="min-w-0 break-words">{message}</span>;

  const before = message.slice(0, idx);
  const after = message.slice(idx + toolName.length);

  return (
    <span className="min-w-0 break-words">
      {before}
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
        {toolName}
      </code>
      {after}
    </span>
  );
};

const AuditEntryRow = ({ entry }: { entry: AuditEntry }) => {
  if (entry.status === "pending") {
    return (
      <div className="flex items-center gap-2 py-1">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        <span className="min-w-0 animate-pulse break-words text-foreground/70">
          <MessageText message={entry.message} toolName={entry.toolName} />
        </span>
      </div>
    );
  }

  const Icon =
    entry.status === "done"
      ? Check
      : entry.status === "error"
        ? X
        : entry.status === "warning"
          ? AlertTriangle
          : ChevronDown;

  const iconColor =
    entry.status === "error"
      ? "text-destructive"
      : entry.status === "warning"
        ? "text-amber-500"
        : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <Icon className={`size-3.5 shrink-0 ${iconColor}`} />
      {entry.kind && KIND_LABELS[entry.kind] && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
            entry.status === "error" ? "bg-destructive/10 text-destructive" : "bg-muted"
          }`}
        >
          {KIND_LABELS[entry.kind]}
        </span>
      )}
      <MessageText message={entry.message} toolName={entry.toolName} />
      {entry.orderId && (
        <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-muted-foreground">
          {entry.orderId}
        </code>
      )}
      {entry.expected != null && entry.actual != null && (
        <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
          ₹{entry.actual} &gt; ₹{entry.expected}
        </span>
      )}
      {entry.via && (
        <span className="shrink-0 text-muted-foreground/60">via {entry.via}</span>
      )}
    </div>
  );
};

const AuditTrail = ({
  entries,
  defaultOpen = false,
}: {
  entries: AuditEntry[];
  defaultOpen?: boolean;
}) => {
  if (entries.length === 0) return null;

  const hasPending = entries.some((e) => e.status === "pending");

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex gap-2 items-center justify-between rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground outline-none">
        <span>
          {hasPending ? "Executing..." : "View audit trail"}{" "}
          <span className="text-muted-foreground/60">
            ({entries.length})
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-0.5 overflow-hidden py-1">
        <div className="flex min-w-0 items-start justify-start gap-2 px-1">
          <div className="mt-0.5 h-full w-px shrink-0 bg-border/60" />
          <div className="min-w-0 flex-1 pt-0.5">
            {entries.map((entry, i) => (
              <AuditEntryRow key={i} entry={entry} />
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default AuditTrail;