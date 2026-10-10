import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "@/lib/sqlite";
import type { AccountProfile } from "@/lib/account-types";
import { ownsAvatar, cleanProfileAvatars } from "@/lib/profile-avatars";

const avatarSchema = z.string().max(350_000).refine((value) => {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) return false;
  const bytes = Buffer.from(value.split(",")[1], "base64");
  return bytes.length > 32 && bytes.length <= 256_000 &&
    bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 512 &&
    bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 512;
}, "Choose a PNG profile image up to 512 × 512 pixels.");
export const profileInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().max(500),
  avatar: z.union([avatarSchema, z.string().regex(/^\/api\/profile\/avatar\/[a-f0-9]{48}$/)]).nullable(),
  links: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    url: z.string().trim().max(2048).url().refine(value => {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    }, "Use an http or https link without credentials."),
  }).strict()).max(5),
  sharing: z.boolean(),
  shareActivity: z.boolean(),
}).strict();

export function getAccountProfile(ownerId: string, username: string): AccountProfile {
  const row = getDatabase().prepare("SELECT data, share_id FROM account_profiles WHERE owner_id = ?").get(ownerId) as { data: string; share_id: string | null } | undefined;
  if (!row) return { displayName: username, bio: "", avatar: null, links: [], shareId: null, shareActivity: false };
  return { ...JSON.parse(row.data), shareId: row.share_id };
}
export function saveAccountProfile(ownerId: string, input: unknown): AccountProfile {
  const parsed = profileInput.parse(input);
  if (parsed.avatar?.startsWith("/api/") && !ownsAvatar(ownerId, parsed.avatar)) throw new Error("Upload your own profile picture first.");
  const row = getDatabase().prepare("SELECT share_id FROM account_profiles WHERE owner_id = ?").get(ownerId) as { share_id: string | null } | undefined;
  const shareId = parsed.sharing ? row?.share_id || randomBytes(24).toString("hex") : null;
  const { sharing: _sharing, ...data } = parsed;
  getDatabase().prepare("INSERT INTO account_profiles (owner_id, data, share_id) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data, share_id=excluded.share_id").run(ownerId, JSON.stringify(data), shareId);
  cleanProfileAvatars(ownerId, data.avatar);
  return { ...data, shareId };
}
export function getSharedProfile(shareId: string): { ownerId: string; profile: AccountProfile } | null {
  if (!/^[a-f0-9]{48}$/.test(shareId)) return null;
  const row = getDatabase().prepare("SELECT owner_id, data FROM account_profiles WHERE share_id = ?").get(shareId) as { owner_id: string; data: string } | undefined;
  return row ? { ownerId: row.owner_id, profile: { ...JSON.parse(row.data), shareId } } : null;
}
