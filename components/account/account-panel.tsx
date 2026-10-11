"use client";
import type { ReactNode } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfilePanel } from "@/components/account/profile-panel";
import { UsageDashboard } from "@/components/account/usage-dashboard";
import type { AccountProfile } from "@/lib/account-types";

export type AccountView = "profile" | "agent-hub" | "settings" | "usage";
const accountPages: Array<{id: AccountView; label: string}> = [
  {id: "profile", label: "Profile"},
  {id: "agent-hub", label: "Agent Hub"},
  {id: "settings", label: "Settings"},
  {id: "usage", label: "Usage"},
];
export function AccountPanel({view,onView,onClose,onOpenNav,profile,onProfileChange,profileError,onRetry,children,onOpenManagementPage}: {
  view:AccountView;onView:(view:"profile"|"usage")=>void;onOpenManagementPage?:(view:"agent-hub"|"settings")=>void;onClose:()=>void;onOpenNav:()=>void;
  profile:AccountProfile|null;onProfileChange:(profile:AccountProfile)=>void;profileError:boolean;onRetry:()=>void;children?:ReactNode;
}) {
  const visiblePages = accountPages.filter(item => item.id === "profile" || item.id === "usage" || onOpenManagementPage);
  const managementPage = view === "agent-hub" || view === "settings";
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/55 px-3 py-1 sm:px-5 lg:h-14 lg:flex-nowrap lg:py-0">
      <Button variant="ghost" size="icon" className="size-11 md:hidden" onClick={onOpenNav} aria-label="Open sidebar"><Menu className="size-4"/></Button>
      <Button variant="ghost" className="h-11 gap-2 px-2 text-muted-foreground" onClick={onClose} aria-label="Back to chat"><ArrowLeft className="size-4"/><span>Back to chat</span></Button>
      <nav aria-label="Account" className="flex w-full gap-1 overflow-x-auto lg:ml-auto lg:w-auto">{visiblePages.map(item=><Button variant="ghost" className={"h-11 shrink-0 px-3 sm:px-4 "+(view===item.id?"bg-muted text-foreground":"text-muted-foreground")} key={item.id} aria-current={view===item.id?"page":undefined} onClick={() => { if (item.id === "profile" || item.id === "usage") onView(item.id); else onOpenManagementPage?.(item.id); }}>{item.label}</Button>)}</nav>
    </header>
    {managementPage ? <main aria-label={accountPages.find(item => item.id === view)?.label} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main> : <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        {view==="usage"?<UsageDashboard/>:profile?<ProfilePanel profile={profile} onChange={onProfileChange}/>:<div role="status" className="text-sm text-muted-foreground">{profileError?<><p>Could not load your profile.</p><Button variant="outline" className="mt-3" onClick={onRetry}>Try again</Button></>:"Loading profile…"}</div>}
      </div>
    </main>}
  </div>;
}
