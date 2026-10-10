"use client";
import { ArrowLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfilePanel } from "@/components/account/profile-panel";
import { UsageDashboard } from "@/components/account/usage-dashboard";
import type { AccountProfile } from "@/lib/account-types";
export function AccountPanel({view,onView,onClose,onOpenNav,profile,onProfileChange,profileError,onRetry}: {
  view:"profile"|"usage";onView:(view:"profile"|"usage")=>void;onClose:()=>void;onOpenNav:()=>void;
  profile:AccountProfile|null;onProfileChange:(profile:AccountProfile)=>void;profileError:boolean;onRetry:()=>void;
}) {
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 px-3 sm:px-5">
      <Button variant="ghost" size="icon" className="size-11 md:hidden" onClick={onOpenNav} aria-label="Open sidebar"><Menu className="size-4"/></Button>
      <Button variant="ghost" className="h-11 gap-2 px-2 text-muted-foreground" onClick={onClose}><ArrowLeft className="size-4"/><span className="hidden sm:inline">Back to chat</span></Button>
      <nav aria-label="Account" className="ml-auto flex gap-1">{(["profile","usage"] as const).map(item=><Button variant="ghost" className={"h-11 px-4 "+(view===item?"bg-muted text-foreground":"text-muted-foreground")} key={item} aria-current={view===item?"page":undefined} onClick={()=>onView(item)}>{item==="profile"?"Profile":"Usage"}</Button>)}</nav>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        {view==="usage"?<UsageDashboard/>:profile?<ProfilePanel profile={profile} onChange={onProfileChange}/>:<div role="status" className="text-sm text-muted-foreground">{profileError?<><p>Could not load your profile.</p><Button variant="outline" className="mt-3" onClick={onRetry}>Try again</Button></>:"Loading profile…"}</div>}
      </div>
    </main>
  </div>;
}
