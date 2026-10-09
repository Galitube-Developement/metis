"use client";
import {
  Activity, ArrowRight, Check, CircleHelp, Clock, Code, Cpu, Database, File,
  Folder, Gauge, Globe, Info, ListChecks, Mail, MemoryStick, Monitor, Network,
  Palette, Search, Settings, Shield, SlidersHorizontal, Sparkles, Terminal,
  User, Users, Wrench, Zap, type LucideIcon,
} from "lucide-react";
const icons: Record<string, LucideIcon> = {
  activity: Activity, "arrow-right": ArrowRight, check: Check, "circle-help": CircleHelp,
  clock: Clock, code: Code, cpu: Cpu, database: Database, file: File, folder: Folder,
  gauge: Gauge, globe: Globe, info: Info, "list-checks": ListChecks, mail: Mail,
  "memory-stick": MemoryStick, monitor: Monitor, network: Network, palette: Palette,
  search: Search, settings: Settings, shield: Shield, "sliders-horizontal": SlidersHorizontal,
  sparkles: Sparkles, terminal: Terminal, user: User, users: Users, wrench: Wrench, zap: Zap,
};
export function ChatIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name ? icons[name] : undefined;
  return Icon ? <Icon aria-hidden="true" className={className ?? "size-4 shrink-0"} strokeWidth={1.7} /> : null;
}
