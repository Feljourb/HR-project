import { Bell, ChevronRight, CircleHelp, Menu, Search } from "lucide-react";
import { Avatar } from "@/components/avatar";

export function Header({ username, onToggleSidebar }: { username: string; onToggleSidebar: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-5 lg:px-6">
      <button aria-label="Toggle navigation" onClick={onToggleSidebar} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
        <Menu className="size-5" />
      </button>

      <div className="hidden items-center gap-2 text-sm text-slate-400 md:flex">
        <span>Dashboard</span>
        <ChevronRight className="size-3.5" />
        <span className="font-semibold text-[#0F172A]">Overview</span>
      </div>

      {/* Search: works once the directory module exists. */}
      <div className="relative ml-auto w-full max-w-[440px] lg:mx-auto">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search colleagues by name, email, or department..."
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-xs outline-none focus:border-[#23355d] focus:bg-white"
        />
      </div>

      <div className="hidden items-center gap-5 sm:flex">
        <button aria-label="Notifications" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <Bell className="size-[19px]" />
        </button>
        <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#23355d]">
          <CircleHelp className="size-4" /> Help
        </button>
        <Avatar username={username} className="size-9 border border-slate-200 bg-[#0F172A] text-white" />
      </div>
    </header>
  );
}
