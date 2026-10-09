import type { ProjectAgent, ProjectHandoff } from "./project-team-types";

export const isActiveHandoff = (handoff: ProjectHandoff) => handoff.status === "queued" || handoff.status === "running";
export const handoffTime = (handoff: ProjectHandoff) => Date.parse(handoff.updatedAt || handoff.createdAt) || 0;

/** A stable forest layout. Missing/archived supervisors stay unlinked, never invented. */
export function buildTeamGraph(agents: ProjectAgent[], handoffs: ProjectHandoff[], projectId: string) {
 const visible = agents.filter(agent => agent.projectId === projectId && !agent.archivedAt && agent.status !== "archived");
 const byId = new Map(visible.map(agent => [agent.id, agent]));
 const parents = new Map<string, string>();
 for (const agent of visible) {
  if (!agent.supervisorId || !byId.has(agent.supervisorId)) continue;
  const seen = new Set([agent.id]);
  let cursor: string | undefined = agent.supervisorId;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
   seen.add(cursor);
   cursor = byId.get(cursor)?.supervisorId;
  }
  if (!cursor || !seen.has(cursor)) parents.set(agent.id, agent.supervisorId);
 }
 const children = new Map<string, ProjectAgent[]>();
 for (const agent of visible) {
  const parent = parents.get(agent.id);
  if (parent) children.set(parent, [...(children.get(parent) || []), agent]);
 }
 const nodes: { agent: ProjectAgent; x: number; y: number }[] = [];
 let leaf = 0;
 const place = (agent: ProjectAgent, depth: number): number => {
  const descendants = children.get(agent.id) || [];
  const positions = descendants.map(child => place(child, depth + 1));
  const x = positions.length ? (positions[0] + positions[positions.length - 1]) / 2 : 85 + leaf++ * 170;
  nodes.push({ agent, x, y: 65 + depth * 155 });
  return x;
 };
 for (const root of visible.filter(agent => !parents.has(agent.id))) place(root, 0);
 const activity = handoffs.filter(handoff => handoff.projectId === projectId).sort((a, b) => handoffTime(b) - handoffTime(a) || a.id.localeCompare(b.id));
 // Show every active connection plus the latest past exchange per directed pair.
 const exchanges = new Map<string, { source: string; target: string; active: boolean; handoff: ProjectHandoff; count: number }>();
 for (const handoff of activity) {
  const source = handoff.senderAgentId;
  if (!source || !byId.has(source) || !byId.has(handoff.recipientAgentId) || source === handoff.recipientAgentId) continue;
  const key = source + ":" + handoff.recipientAgentId;
  const previous = exchanges.get(key);
  const active = isActiveHandoff(handoff);
  if (!previous) exchanges.set(key, { source, target: handoff.recipientAgentId, active, handoff, count: 1 });
  else {
   previous.count++;
   if (active && !previous.active) { previous.active = true; previous.handoff = handoff; }
  }
 }
 let recentConnections = 0;
 return {
  nodes,
  reporting: [...parents].map(([source, target]) => ({ source, target })),
  exchanges: [...exchanges.values()].filter(edge => edge.active || recentConnections++ < 8),
  activity,
  width: Math.max(170, leaf * 170),
  height: Math.max(170, ...nodes.map(node => node.y + 95)),
 };
}
