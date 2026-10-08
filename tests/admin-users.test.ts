import assert from "node:assert/strict";
import test from "node:test";
import { isolationFixture } from "./isolation-fixture";

const fixture = isolationFixture();
test("managed mappings reject unsafe creation/update atomically", async () => {
  try {
    const { createManagedUser, patchManagedUser, deleteManagedUser, listAdminUsers } = await import("../lib/admin-users");
    const { requireUserExecutionIdentity, getUserAccess } = await import("../lib/user-access");
    const { getDatabase } = await import("../lib/sqlite");
    const admin = createManagedUser({ username: "adminone", password: "password1", workspaceRoot: fixture.dir });
    assert.equal(admin.isAdmin, true);
    assert.throws(() => patchManagedUser(admin.id, { isAdmin: false }), /last admin/);
    assert.throws(() => deleteManagedUser(admin.id, "other"), /last admin/);
    const count = listAdminUsers().length;
    const create = (username: string, workspaceRoot?: string, osUsername?: string) =>
      createManagedUser({ username, password: "password1", workspaceRoot, osUsername });
    assert.throws(() => create("unmapped"), /isolated unprivileged/);
    assert.equal(listAdminUsers().length, count);
    assert.throws(() => create("missing", "/isolated/alice", "no-such-user"), /does not exist/);
    assert.throws(() => create("rootbind", "/root/virtual-metis", "root"), /explicitly configured/);
    const alice = create("aliceweb", "/isolated/alice", "alice");
    assert.equal(requireUserExecutionIdentity(alice.id).uid, 12001);
    assert.throws(() => create("aliasweb", "/isolated/alias", "alias"), /already mapped/);
    fixture.state.owner = 12002;
    assert.throws(() => create("samews", "/isolated/alice", "bob"), /distinct/);
    assert.throws(() => create("nestedws", "/isolated/alice/project", "bob"), /distinct/);
    fixture.state.alias = "/isolated/alice";
    assert.throws(() => create("symlinkws", "/isolated/link", "bob"), /distinct/);
    fixture.state.alias = "";
    const bob = create("bobweb", "/isolated/bob", "bob");
    const previous = getUserAccess(bob.id);
    const hash = () => (getDatabase().prepare("SELECT password_hash AS hash FROM users WHERE id=?").get(bob.id) as { hash: string }).hash;
    const previousHash = hash();
    assert.throws(() => patchManagedUser(bob.id, { password: "newpassword", workspaceRoot: "/isolated/alice" }), /distinct/);
    assert.equal(hash(), previousHash, "failed mapping update rolls back password too");
    assert.deepEqual(getUserAccess(bob.id), previous);
    assert.throws(() => patchManagedUser(bob.id, { osUsername: null }), /isolated unprivileged/);
    assert.throws(() => patchManagedUser(bob.id, { osUsername: "alice" }), /already mapped/);
    assert.throws(() => deleteManagedUser(bob.id, bob.id), /own account/);
    const secondAdmin = createManagedUser({ username: "secondadmin", password: "password1", isAdmin: true, workspaceRoot: "/admin-other" });
    assert.throws(() => patchManagedUser(secondAdmin.id, { isAdmin: false }), /isolated unprivileged/);
    assert.equal(listAdminUsers().find(user => user.id === secondAdmin.id)?.isAdmin, true);
    // A single transaction may replace the privileged mapping while demoting.
    deleteManagedUser(bob.id, admin.id);
    patchManagedUser(secondAdmin.id, { isAdmin: false, osUsername: "bob", workspaceRoot: "/isolated/bob" });
    assert.equal(requireUserExecutionIdentity(secondAdmin.id).uid, 12002);
  } finally { fixture.restore(); }
});
