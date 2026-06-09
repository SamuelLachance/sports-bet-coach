import type { ClientSyncSnapshot } from "./types";

let snapshot: ClientSyncSnapshot | null = null;

export function getClientSnapshot(): ClientSyncSnapshot | null {
  return snapshot;
}

export function setClientSnapshot(next: ClientSyncSnapshot): void {
  snapshot = next;
}

export function clearClientSnapshot(): void {
  snapshot = null;
}
