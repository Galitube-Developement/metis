import assert from "node:assert/strict";
import test from "node:test";
import { buildTeamGraph } from "../lib/project-team-graph";
import type { ProjectAgent, ProjectHandoff } from "../lib/project-team-types";
const agent = (id: string, supervisorId?: string, overrides: Partial<ProjectAgent> = {}): ProjectAgent => ({ id, supervisorId, projectId: "p", chatId: "chat-" + id, name: id, role: "Role", systemPrompt: "", color: "#1767ed", createdAt: "", updatedAt: "", status: "idle", ...overrides });
const handoff = (id: string, senderAgentId: string | undefined, recipientAgentId: string, status: ProjectHandoff["status"], time: number, projectId = "p"): ProjectHandoff => ({ id, projectId, senderAgentId, recipientAgentId, status, task: id, createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString() });

test("hierarchy lays out independent trees without overlaps and links only actual supervisors", () => {
 const agents = [agent("lead"), agent("a", "lead"), agent("b", "lead"), agent("c", "a"), agent("d"), agent("orphan", "missing"), agent("archived", "lead", { archivedAt: "2026-01-01" }), agent("outside", undefined, { projectId: "other" })];
 const graph = buildTeamGraph(agents, [], "p");
 assert.equal(graph.nodes.length, 6);
 assert.deepEqual(graph.reporting, [{source: "a", target: "lead"}, {source: "b", target: "lead"}, {source: "c", target: "a"}]);
 assert.equal(new Set(graph.nodes.map(node => node.x + ":" + node.y)).size, graph.nodes.length);
 const positions = new Map(graph.nodes.map(node => [node.agent.id, node]));
 for (const edge of graph.reporting) assert.ok(positions.get(edge.source)!.y > positions.get(edge.target)!.y);
 assert.ok(graph.nodes.every(node => node.x > 0 && node.x < graph.width && node.y < graph.height));
 assert.deepEqual(buildTeamGraph(agents, [], "p"), graph);
});
test("malformed cycles and archived supervisors cannot hide nodes or invent reporting edges", () => {
 const graph = buildTeamGraph([agent("a", "b"), agent("b", "a"), agent("c", "a"), agent("old", undefined, {status: "archived"}), agent("orphan", "old")], [], "p");
 assert.equal(graph.nodes.length, 4);
 assert.equal(graph.reporting.length, 0);
 assert.ok(graph.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
 assert.deepEqual(buildTeamGraph([], [], "p").nodes, []);
});
test("communication preserves direction and prioritizes active assignments over newer past work", () => {
 const agents = [agent("a"), agent("b")];
 const history = [handoff("past", "a", "b", "completed", 3000), handoff("active", "a", "b", "running", 2000), handoff("reply", "b", "a", "completed", 4000), handoff("owner", undefined, "b", "queued", 5000), handoff("foreign", "a", "b", "queued", 6000, "other"), handoff("unknown", "missing", "a", "completed", 1000)];
 const graph = buildTeamGraph(agents, history, "p");
 assert.equal(graph.exchanges.length, 2);
 const outgoing = graph.exchanges.find(edge => edge.source === "a")!;
 assert.equal(outgoing.active, true);
 assert.equal(outgoing.handoff.id, "active");
 assert.equal(outgoing.count, 2);
 assert.equal(graph.exchanges.find(edge => edge.source === "b")!.active, false);
 assert.deepEqual(graph.activity.map(h => h.id), ["owner", "reply", "past", "active", "unknown"]);
 assert.equal(buildTeamGraph(agents, [history[0]], "p").exchanges[0].active, false);
 assert.equal(buildTeamGraph(agents, [], "p").exchanges.length, 0);
});


test("overview bounds old connections while preserving every active connection", () => {
 const agents = [agent("lead"), ...Array.from({length: 12}, (_, i) => agent("peer-" + i))];
 const handoffs = agents.slice(1).map((peer, i) => handoff("past-" + i, "lead", peer.id, "completed", 1000 + i));
 handoffs.push(handoff("old-active", "peer-0", "lead", "running", 1));
 const graph = buildTeamGraph(agents, handoffs, "p");
 assert.equal(graph.exchanges.filter(edge => !edge.active).length, 8);
 assert.equal(graph.exchanges.filter(edge => edge.active).length, 1);
 assert.equal(graph.exchanges.find(edge => edge.active)!.handoff.id, "old-active");
 assert.equal(graph.activity.length, 13);
 assert.ok(!graph.exchanges.some(edge => edge.handoff.id === "past-0"));
});
