/**
 * PROTOTYPE: in-app notification UX — throwaway, for wayfinder ticket #5.
 *
 * Question: what should an in-app notification look like and how does it behave?
 * Three variants, gated behind `?variant=`:
 *   a — bell in the sidebar footer, dropdown panel, drawer for full history
 *   b — top bar across the main area, grouped dropdown, tabbed drawer
 *   c — no bell: "Notifications" nav item in the sidebar opening a page-style drawer
 *
 * Stub data only (v1-candidate events: refund approved/declined, question
 * reply, new refund request). Read state lives in a module-level store so it
 * survives navigation; nothing persists. Throw this file away once the UX
 * decision is recorded in the spec.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { createPortal } from "react-dom";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  MessageCircle,
  Receipt,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { UserAvatar } from "~/components/user-avatar";

// ---------------------------------------------------------------------------
// Stub data + module store (survives navigation, not reloads)
// ---------------------------------------------------------------------------

export type NotificationType =
  | "refund_approved"
  | "refund_declined"
  | "question_reply"
  | "refund_request";

export interface NotificationItem {
  id: number;
  type: NotificationType;
  actor: string;
  copy: string;
  time: string;
  to: string;
  read: boolean;
}

const TYPE_META: Record<NotificationType, { icon: LucideIcon; iconClass: string; group: string }> = {
  refund_approved: {
    icon: CheckCircle2,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    group: "Refunds",
  },
  refund_declined: {
    icon: XCircle,
    iconClass: "text-red-600 dark:text-red-400",
    group: "Refunds",
  },
  question_reply: {
    icon: MessageCircle,
    iconClass: "text-blue-600 dark:text-blue-400",
    group: "Questions",
  },
  refund_request: {
    icon: Receipt,
    iconClass: "text-amber-600 dark:text-amber-400",
    group: "Refund requests",
  },
};

const INITIAL_ITEMS: NotificationItem[] = [
  {
    id: 1,
    type: "refund_request",
    actor: "System",
    copy: "New refund request from Sam Rivera for “Advanced TypeScript Patterns” ($79).",
    time: "5m ago",
    to: "/admin/refunds",
    read: false,
  },
  {
    id: 2,
    type: "question_reply",
    actor: "Maya Chen",
    copy: "Maya replied to your question “What's the difference between any and unknown?”",
    time: "1h ago",
    to: "/courses",
    read: false,
  },
  {
    id: 3,
    type: "refund_approved",
    actor: "Platform Admin",
    copy: "Your refund request for “Advanced TypeScript Patterns” was approved — $79 refunded.",
    time: "3h ago",
    to: "/dashboard",
    read: false,
  },
  {
    id: 4,
    type: "question_reply",
    actor: "Maya Chen",
    copy: "Maya replied to your question “How do I narrow a union type safely?”",
    time: "Yesterday",
    to: "/courses",
    read: false,
  },
  {
    id: 5,
    type: "refund_declined",
    actor: "Platform Admin",
    copy: "Your refund request for “Intro to Video Editing” was declined — 82% of the course completed.",
    time: "Yesterday",
    to: "/dashboard",
    read: true,
  },
  {
    id: 6,
    type: "question_reply",
    actor: "Diego Alvarez",
    copy: "Diego replied to your question “Can I use generics with React props?”",
    time: "2d ago",
    to: "/courses",
    read: true,
  },
  {
    id: 7,
    type: "refund_request",
    actor: "System",
    copy: "New refund request from Priya Nair for “Intro to Video Editing” ($29).",
    time: "2d ago",
    to: "/admin/refunds",
    read: true,
  },
  {
    id: 8,
    type: "refund_approved",
    actor: "Platform Admin",
    copy: "Your refund request for “Motion Design Basics” was approved — $49 refunded.",
    time: "4d ago",
    to: "/dashboard",
    read: true,
  },
];

interface Store {
  items: NotificationItem[];
}

let store: Store = { items: INITIAL_ITEMS.map((n) => ({ ...n })) };
const listeners = new Set<() => void>();

function emit() {
  store = { items: [...store.items] };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Store {
  return store;
}

function markRead(id: number) {
  store = {
    items: store.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
  };
  emit();
}

function markAllRead() {
  store = { items: store.items.map((n) => ({ ...n, read: true })) };
  emit();
}

function unreadCount(items: NotificationItem[]) {
  return items.filter((n) => !n.read).length;
}

function useNotifications() {
  return useSyncExternalStore(subscribe, getSnapshot).items;
}

// ---------------------------------------------------------------------------
// Shared item anatomy
// ---------------------------------------------------------------------------

function NotificationRow({
  item,
  onClick,
}: {
  item: NotificationItem;
  onClick: (item: NotificationItem) => void;
}) {
  const meta = TYPE_META[item.type];
  const Icon = meta.icon;
  return (
    <button
      onClick={() => onClick(item)}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-accent",
        !item.read && "bg-primary/5"
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", meta.iconClass)} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm leading-snug",
            item.read ? "text-muted-foreground" : "text-foreground"
          )}
        >
          <span className="font-medium">{item.actor}</span> · {item.copy}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{item.time}</p>
      </div>
      {!item.read && (
        <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared drawer (the "full notifications page" for history)
// ---------------------------------------------------------------------------

function NotificationDrawer({
  open,
  onClose,
  withTabs = false,
}: {
  open: boolean;
  onClose: () => void;
  withTabs?: boolean;
}) {
  const items = useNotifications();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const navigate = useNavigate();

  if (!open) return null;

  const visible = withTabs && tab === "unread" ? items.filter((n) => !n.read) : items;

  function onItemClick(item: NotificationItem) {
    markRead(item.id);
    onClose();
    navigate(item.to);
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="fixed right-0 top-0 z-50 flex h-screen w-[28rem] max-w-full flex-col border-l border-border bg-popover text-popover-foreground shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {withTabs && (
          <div className="flex gap-1 border-b border-border px-3 py-2">
            {(["all", "unread"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60"
                )}
              >
                {t}
                {t === "unread" && unreadCount(items) > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    {unreadCount(items)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            visible.map((item) => (
              <NotificationRow key={item.id} item={item} onClick={onItemClick} />
            ))
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Variant A — bell in the sidebar footer, dropdown, drawer for history
// ---------------------------------------------------------------------------

export function PrototypeSidebarBell() {
  const items = useNotifications();
  const [panelOpen, setPanelOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const unread = unreadCount(items);

  useEffect(() => {
    if (!panelOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setPanelOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [panelOpen]);

  function onItemClick(item: NotificationItem) {
    markRead(item.id);
    setPanelOpen(false);
    navigate(item.to);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setPanelOpen((v) => !v)}
        title="Notifications"
        className="relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread}
          </span>
        )}
      </button>

      {panelOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <CheckCheck className="size-3.5" />
              Mark all read
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {items.slice(0, 5).map((item) => (
              <NotificationRow key={item.id} item={item} onClick={onItemClick} />
            ))}
          </div>
          <button
            onClick={() => {
              setPanelOpen(false);
              setDrawerOpen(true);
            }}
            className="block w-full border-t border-border py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            View all notifications
          </button>
        </div>
      )}

      <NotificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B — top bar across the main area, grouped dropdown, tabbed drawer
// ---------------------------------------------------------------------------

export function PrototypeTopBar({
  currentUser,
}: {
  currentUser: { id: number; name: string; role: string; avatarUrl: string | null } | null;
}) {
  const items = useNotifications();
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const unread = unreadCount(items);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onItemClick(item: NotificationItem) {
    markRead(item.id);
    setOpen(false);
    navigate(item.to);
  }

  const groups = Object.entries(
    items.reduce<Record<string, NotificationItem[]>>((acc, item) => {
      const group = TYPE_META[item.type].group;
      (acc[group] ??= []).push(item);
      return acc;
    }, {})
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Cadence
      </span>

      <div ref={ref} className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            title="Notifications"
            className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Bell className="size-4" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                {unread}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold">Notifications</span>
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CheckCheck className="size-3.5" />
                  Mark all read
                </button>
              </div>
              <div className="max-h-[24rem] overflow-y-auto p-1">
                {groups.map(([group, groupItems]) => (
                  <div key={group}>
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </div>
                    {groupItems.map((item) => (
                      <NotificationRow
                        key={item.id}
                        item={item}
                        onClick={onItemClick}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  setDrawerOpen(true);
                }}
                className="block w-full border-t border-border py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>

        {currentUser && (
          <UserAvatar name={currentUser.name} avatarUrl={currentUser.avatarUrl} />
        )}
      </div>

      <NotificationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        withTabs
      />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Variant C — "Notifications" nav item in the sidebar, page-style drawer
// ---------------------------------------------------------------------------

export function PrototypeSidebarNavItem() {
  const items = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = unreadCount(items);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        Notifications
        {unread > 0 && (
          <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
      <NotificationDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
