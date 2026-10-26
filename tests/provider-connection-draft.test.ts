import assert from "node:assert/strict";
import test from "node:test";
import { newProviderConnectionIdentity } from "../lib/provider-connection-draft";

test("new drafts have no persisted ID and use the provider's first free identifier", () => {
  for (const key of ["openai", "codex", "claude-code", "antigravity", "custom-provider"]) {
    assert.deepEqual(newProviderConnectionIdentity(key, []), { id: "", slug: `${key}-main` });
    assert.deepEqual(newProviderConnectionIdentity(key, [{ slug: `${key}-main` }]), {
      id: "", slug: `${key}-main-2`,
    });
  }
});

test("suffix allocation fills gaps and ignores labels and connection order", () => {
  const connections = [
    { id: "existing-a", slug: "codex-main-3", label: "Same name" },
    { id: "existing-b", slug: "codex-main", label: "Same name" },
    { id: "existing-c", slug: "other-main-2", label: "Same name" },
  ];
  assert.equal(newProviderConnectionIdentity("codex", connections).slug, "codex-main-2");
  assert.deepEqual(
    newProviderConnectionIdentity("codex", connections),
    newProviderConnectionIdentity("codex", [...connections].reverse()),
  );
});

test("a draft stays stable while labels change; the next draft uses refreshed connections", () => {
  const connections = [{ slug: "openai-main", label: "OpenAI" }];
  const draft = { ...newProviderConnectionIdentity("openai", connections), label: "OpenAI" };
  const renamed = { ...draft, label: "Another label" };
  assert.equal(renamed.slug, "openai-main-2");
  assert.equal(renamed.id, "");
  const refreshed = [...connections, { slug: draft.slug, label: draft.label }];
  assert.equal(draft.slug, "openai-main-2");
  assert.deepEqual(newProviderConnectionIdentity("openai", refreshed), {
    id: "", slug: "openai-main-3",
  });
  assert.equal(newProviderConnectionIdentity("openai", connections).slug, "openai-main-2");
});

test("allocation handles many existing accounts without mutating the inventory", () => {
  const connections = Object.freeze(Array.from({ length: 100 }, (_, index) =>
    Object.freeze({ slug: index === 0 ? "custom-main" : `custom-main-${index + 1}` }),
  ));
  assert.equal(newProviderConnectionIdentity("custom", connections).slug, "custom-main-101");
  assert.equal(connections.length, 100);
});
