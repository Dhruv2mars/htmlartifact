import { customAlphabet } from "nanoid";

const draftId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const internalId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 20);
const suffix = customAlphabet("0123456789abcdefghjkmnpqrstvwxyz", 4);
// No 0/O/1/I/L: invite codes are read aloud and retyped.
const inviteChars = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 12);

export function newDraftId(): string {
  return draftId();
}

export function newInternalId(): string {
  return internalId();
}

// A workspace's URL handle: its name plus a random suffix, so handles never
// collide and never reveal whether a name is already taken ("acme-k3x9").
export function workspaceHandle(name: string): string {
  const base = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return `${base || "workspace"}-${suffix()}`;
}

// 60 bits of randomness, formatted for humans: "HA-7KQ2-MX9P-4TRA".
export function newInviteCode(): string {
  const raw = inviteChars();
  return `HA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // The /join/<code> link that `workspace invite` prints: its last path segment.
  const segment = value.includes("/") ? value.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() || "" : value;
  const cleaned = segment.toUpperCase().replace(/[^0-9A-Z]/g, "");
  // Strip the "HA" prefix only when present: the random part may start with HA.
  const raw = cleaned.length === 14 && cleaned.startsWith("HA") ? cleaned.slice(2) : cleaned;
  return raw.length === 12 ? `HA-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}` : null;
}
