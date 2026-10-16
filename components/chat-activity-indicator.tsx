import { LoaderCircle } from "lucide-react";
import type { ActivityIndicator } from "@/lib/chat-activity";
import { cn } from "@/lib/utils";
export function ChatActivityIndicator({ indicator }: { indicator: ActivityIndicator }) {
  if (!indicator) return null;
  if (indicator === "running") return <span role="img" aria-label="Working" title="Working" className="inline-flex shrink-0"><LoaderCircle aria-hidden="true" className="size-3 animate-spin text-muted-foreground motion-reduce:animate-none"/></span>;
  const label = indicator === "question" ? "Waiting for your input" : indicator === "error" ? "Needs your attention" : "Unread updates";
  return <span role="img" aria-label={label} title={label} className={cn("size-2 shrink-0 rounded-full", indicator === "question" ? "bg-amber-400" : indicator === "error" ? "bg-red-500" : "bg-blue-500")}/>;
}
