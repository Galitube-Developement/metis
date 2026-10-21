import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectMessageAuthor, projectMessageMembers } from "../lib/project-message-authors";
import { ProjectMessageAuthor } from "../components/project-message-author";
Object.assign(globalThis, { React });
const owner = { userId: "owner", username: "login-owner", displayName: "Elena Weber", avatar: "/api/profile/avatar/" + "a".repeat(48) };
const member = { userId: "member", username: "login-member", displayName: "Mila Sommer", avatar: null };
const message = { authorId: "owner", authorName: "Outdated username" };

test("names remain hidden without a project member list, in solo projects and for pending invites", () => {
  for (const payload of [{ members: [] }, { members: [owner] }, { members: [owner], invitations: [member] }, { members: [owner, owner] }]) {
    const members = projectMessageMembers(payload);
    assert.equal(projectMessageAuthor(members, message), null);
    assert.equal(renderToStaticMarkup(<ProjectMessageAuthor members={members} {...message}/>), "");
  }
});

test("shared messages prefer current public names and avatars, then usernames", () => {
  const members = projectMessageMembers({ members: [owner, member] });
  assert.deepEqual(projectMessageAuthor(members, message), { displayName: owner.displayName, avatar: owner.avatar });
  const fallback = projectMessageMembers({ members: [owner, { ...member, displayName: " " }] });
  assert.deepEqual(projectMessageAuthor(fallback, { authorId: "member", authorName: "old" }), { displayName: "login-member", avatar: null });
  const html = renderToStaticMarkup(<ProjectMessageAuthor members={members} {...message}/>);
  assert.match(html, /Elena Weber/);
  assert.doesNotMatch(html, /Outdated username|login-owner/);
  assert.match(html, /data-project-message-author/);
});

test("username-only historical and optimistic messages resolve, IDs cannot be reassigned by a matching name", () => {
  const members = projectMessageMembers({ members: [owner, member] });
  assert.equal(projectMessageAuthor(members, { authorName: "login-member" })?.displayName, "Mila Sommer");
  assert.deepEqual(projectMessageAuthor(members, { authorId: "removed-user", authorName: "login-member" }), { displayName: "login-member", avatar: null });
  assert.equal(projectMessageAuthor(members, {}), null);
});

test("membership and profile changes apply to old messages without mutating stored authors", () => {
  const before = structuredClone(message);
  assert.equal(projectMessageAuthor([owner, member], message)?.displayName, "Elena Weber");
  assert.equal(projectMessageAuthor([{ ...owner, displayName: "Elena Updated", avatar: null }, member], message)?.displayName, "Elena Updated");
  assert.equal(projectMessageAuthor([owner], message), null);
  assert.deepEqual(message, before);
});

test("only identity fields cross the client boundary and malformed membership cannot enable labels", () => {
  assert.deepEqual(projectMessageMembers({ members: [{ ...owner, bio: "private", links: ["secret"] }] }), [owner]);
  for (const payload of [null, {}, { members: "two" }, { members: [{ username: "unknown" }] }]) assert.throws(() => projectMessageMembers(payload));
});
