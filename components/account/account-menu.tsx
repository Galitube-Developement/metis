"use client";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, ChevronsUpDown, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AccountProfile } from "@/lib/account-types";
export function useAccountProfile(enabled: boolean) {
  const [profile,setProfile]=useState<AccountProfile|null>(null);
  const [error,setError]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!enabled) { setProfile(null);return; }
    const controller=new AbortController();setError(false);
    void fetch("/api/profile",{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("Could not load profile");
      setProfile((await response.json()).profile);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[enabled,revision]);
  return {profile,setProfile,error,retry:()=>setRevision(value=>value+1)};
}
export function ProfileAvatar({profile,name,className}: {profile:AccountProfile|null;name:string;className?:string}) {
  return <Avatar className={className}>
    {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
    <AvatarFallback className="bg-muted text-foreground">{(profile?.displayName || name).slice(0,2).toUpperCase()}</AvatarFallback>
  </Avatar>;
}
export function AccountMenu({profile,username,updateAvailable,onSettings,onProfile,onUsage}: {
  profile:AccountProfile|null;username:string;updateAvailable:boolean;
  onSettings:()=>void;onProfile:()=>void;onUsage:()=>void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className="h-12 w-full justify-start gap-2.5 px-2.5" aria-label="Open account menu">
        <span className="relative shrink-0"><ProfileAvatar profile={profile} name={username} className="size-8" />
          {updateAvailable ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background" aria-label="Update available" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-sm">{profile?.displayName || username}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-52">
      <div className="truncate px-2 py-2 text-xs text-muted-foreground">{username}</div>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onSettings}><Settings /> Settings{updateAvailable ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}</DropdownMenuItem>
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onProfile}><UserRound /> Profile</DropdownMenuItem>
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onUsage}><ChartNoAxesCombined /> Usage</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
