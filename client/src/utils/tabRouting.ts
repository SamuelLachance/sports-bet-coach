import type { Tab } from "../components/Layout";

const ROUTABLE_TABS: Tab[] = [
  "home",
  "picks",
  "calendar",
  "leagues",
  "tracking",
  "settings",
];

export function parseTabFromHash(hash: string): Tab {
  const raw = hash.replace(/^#/, "").replace(/\/$/, "").toLowerCase();
  if (!raw || raw === "home") return "home";
  if (ROUTABLE_TABS.includes(raw as Tab)) return raw as Tab;
  return "home";
}

export function tabToHash(tab: Tab): string {
  return tab === "home" ? "" : tab;
}

export function applyTabHash(tab: Tab): void {
  const nextHash = tabToHash(tab);
  const current = window.location.hash.replace(/^#/, "");
  if (current === nextHash) return;
  if (nextHash) {
    window.location.hash = nextHash;
  } else {
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", url);
  }
}
