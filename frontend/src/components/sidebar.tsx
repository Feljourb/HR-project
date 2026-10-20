"use client";

import { useState } from "react";
import Image from "next/image";
import {
  BookOpen, BriefcaseBusiness, Building2, CalendarDays, Check, ChevronDown, ChevronRight,
  ClipboardCheck, FolderOpen, Headphones, LayoutDashboard, LogOut, Plane, ReceiptText,
  ShieldCheck, UsersRound, X, type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";

type NavGroup = {
  label: string;
  icon: LucideIcon;
  restricted?: boolean; // only for HR, managers and admins
  items: [string, LucideIcon][];
};

// Same menu as the validated design. Links come with each module.
const NAV_GROUPS: NavGroup[] = [
  { label: "Personal Space", icon: LayoutDashboard, items: [["Dashboard", LayoutDashboard], ["Leave Requests", CalendarDays], ["Expense Claims", ReceiptText], ["Administrative Documents", FolderOpen]] },
  { label: "Company Services", icon: Building2, items: [["Meeting Room Booking", Building2], ["Travel & Hotel", Plane], ["IT Helpdesk", Headphones]] },
  { label: "Career & Growth", icon: BriefcaseBusiness, items: [["Training Catalog", BookOpen], ["Performance Reviews", ClipboardCheck], ["Internal Job Postings", BriefcaseBusiness]] },
  { label: "Management & HR", icon: ShieldCheck, restricted: true, items: [["Team Approvals", Check], ["Maker-Checker Audit", ShieldCheck], ["Employee Directory", UsersRound]] },
];

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  username: string;
  roleLabel: string;
  canSeeManagement: boolean;
  onLogout: () => void;
};

export function Sidebar({ open, onClose, username, roleLabel, canSeeManagement, onLogout }: SidebarProps) {
  const [expanded, setExpanded] = useState<string[]>(["Personal Space"]);
  const groups = NAV_GROUPS.filter((group) => !group.restricted || canSeeManagement);

  function toggle(label: string) {
    setExpanded((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[264px] flex-col bg-[#192646] text-white transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm">
          <Image src="/logo.png" alt="Silent Believers Distribution" width={56} height={49} className="size-full object-contain" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.12em]">SILENT BELIEVERS</p>
          <p className="text-[10px] tracking-[0.2em] text-blue-200">DISTRIBUTION</p>
        </div>
        <button aria-label="Close navigation" onClick={onClose} className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden">
          <X />
        </button>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {groups.map((group) => {
          const isExpanded = expanded.includes(group.label);
          const GroupIcon = group.icon;
          return (
            <div key={group.label} className="mb-3">
              <button
                aria-expanded={isExpanded}
                onClick={() => toggle(group.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${isExpanded ? "text-white" : "text-slate-400 hover:bg-[#5574c5] hover:text-white"}`}
              >
                <GroupIcon className="size-4" />
                <span className="flex-1">{group.label}</span>
                {group.restricted && <ShieldCheck className="size-3.5" />}
                {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </button>

              {isExpanded && (
                <div className="mt-1 flex flex-col gap-1 pl-2">
                  {group.items.map(([label, Icon]) => (
                    <button
                      key={label}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${label === "Dashboard" ? "bg-white/15 text-white shadow-sm" : "text-slate-300 hover:bg-[#5574c5] hover:text-white"}`}
                    >
                      <Icon className="size-[17px] shrink-0 opacity-90" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Current user + logout */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
          <Avatar username={username} className="size-9 border border-blue-300/40 bg-blue-100 text-blue-800" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{username}</p>
            <p className="truncate text-[10px] text-slate-400">{roleLabel}</p>
          </div>
        </div>
        <button onClick={onLogout} className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-[#5574c5] hover:text-white">
          <LogOut className="size-4" /> Log out
        </button>
      </div>
    </aside>
  );
}
