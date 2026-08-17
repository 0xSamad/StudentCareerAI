import { LayoutDashboard, GraduationCap, Briefcase, Bookmark, FileCheck, UserCheck, Sliders, Bot, Compass } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for StudentCareer AI primary navigation
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/internships", label: "Internships", icon: GraduationCap },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/applications", label: "Applications", icon: FileCheck },
  { href: "/profile", label: "Profile", icon: UserCheck },
  { href: "/role-analyzer", label: "Role Analyzer", icon: Compass },
  { href: "/settings", label: "Settings", icon: Sliders },
  { href: "/agent", label: "Agent", icon: Bot },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
