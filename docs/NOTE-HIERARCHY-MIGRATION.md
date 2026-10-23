# Notes hierarchy migration and rollback

Run this explicit rollout step against the intended database. Ordinary application startup does not rewrite or reorder existing pages. The application can read legacy notes before the migration; new notes already contain page metadata.

1. Preview without writes:

   npx tsx scripts/migrate-note-hierarchy.ts --database /absolute/chat.sqlite --dry-run

2. Apply:

   npx tsx scripts/migrate-note-hierarchy.ts --database /absolute/chat.sqlite --apply

   An optional --backup-dir /absolute/backups selects the backup directory.

Before changing notes, apply creates a consistent full SQLite snapshot with VACUUM INTO, including committed WAL data, and verifies PRAGMA quick_check. The backup file is mode 0600. Keep its reported backupPath with the release record. Attachment files remain in their original namespaces; the migration does not modify them.

One transaction adds missing parentId, sortKey, formatVersion and page appearance fields and writes the note_hierarchy_v1 completion marker. Existing IDs, owners, text whitespace, actual project memberships, scopes, versions, assets, checklists, pins and archive state stay intact. Only ghost-project rehomes and invalid parent-edge repairs increment the affected note versions. Legacy root ordering receives sortKey 0 once; rerunning a completed migration performs no writes or sorting. Learned facts are excluded.

Pages referencing a project that no longer exists move to their creators' private No Project area. Same-creator subtrees remain intact; parent edges crossing creators are detached. A durable SQLite project-delete trigger applies the same preservation rule to future project deletions, including deletes issued by older workers. Unowned legacy pages fall back to the deleted project's owner when that owner is still available. The project-delete confirmation must explain this destination.

## Rollback

npx tsx scripts/migrate-note-hierarchy.ts --database /absolute/chat.sqlite --rollback

The migration journal restores only changed note rows and removes the completion marker in one transaction. It preserves unrelated chat/settings writes and newly created pages. Rollback refuses atomically if any migrated note was edited or deleted afterward. Do not force a database replacement over newer writes: use the additive old/new reader compatibility while resolving those edits, or arrange an explicit recovery window using the recorded full backup.

The additive project-deletion preservation trigger remains installed after metadata rollback. Reapplying after a successful rollback creates a new verified backup and completion marker.

The migration utility does not build, deploy, restart or stop any service. Follow docs/DEPLOY.md for the inactive-slot rollout and runtime verification.
