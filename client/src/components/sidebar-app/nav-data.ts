import { type IconName } from "@/lib/icon-context";

// ---------------------------------------------------------------------------
// Seed navigation data — replace with your own. Icons are keys into the
// icon context (lucide by default; override via IconProvider).
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  icon: IconName;
  badge?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Platform",
    items: [
      { label: "Home", icon: "star" },
      { label: "Inbox", icon: "mail", badge: "12" },
      { label: "Calendar", icon: "clock" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Notifications", icon: "bell", badge: "3" },
      { label: "Members", icon: "users" },
      { label: "Settings", icon: "settings" },
    ],
  },
];
