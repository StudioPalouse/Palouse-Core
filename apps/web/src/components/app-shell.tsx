'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import {
  BookOpen,
  Bot,
  Check,
  ChevronsUpDown,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Menu,
  Monitor,
  Moon,
  Plus,
  Scale,
  Settings,
  Sun,
  Target,
} from 'lucide-react';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@palouse/ui';
import { signOut, useSession } from '@/lib/auth-client';
import { WorkspaceProvider, useActiveWorkspace } from '@/lib/workspace-context';

type NavItem = {
  href: Route;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Extra path prefixes that should also light up this item. */
  match?: string[];
};

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/objectives', label: 'Objectives', icon: Target },
  { href: '/projects', label: 'Projects', icon: KanbanSquare },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, match: ['/reviews'] },
  { href: '/decisions', label: 'Decisions', icon: Scale },
  { href: '/context', label: 'Context', icon: BookOpen },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      className="flex h-14 items-center gap-2 px-5 text-base font-semibold tracking-tight"
    >
      Palouse
    </Link>
  );
}

function WorkspaceSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const { workspaces, workspace, setWorkspaceId } = useActiveWorkspace();
  if (!workspace) return null;

  function select(id: string) {
    setWorkspaceId(id);
    onNavigate?.();
  }

  return (
    <div className="px-3 pb-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent/50 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((ws) => (
            <DropdownMenuItem key={ws.id} onSelect={() => select(ws.id)}>
              <span className="min-w-0 flex-1 truncate">{ws.name}</span>
              {ws.id === workspace.id && <Check className="size-4 shrink-0" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              onNavigate?.();
              router.push('/workspaces/new');
            }}
          >
            <Plus className="size-4" /> New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ThemeRadio() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
      <DropdownMenuRadioItem value="light">
        <Sun className="size-4" /> Light
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">
        <Moon className="size-4" /> Dark
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">
        <Monitor className="size-4" /> System
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

function UserMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const email = session?.user.email ?? '';
  const initial = email.charAt(0).toUpperCase() || '?';

  return (
    <div className="border-t p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hover:bg-accent/50 flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors"
          >
            <span className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
              {initial}
            </span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
              {email || 'Account'}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="truncate font-normal">
            {email || 'Account'}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
          <ThemeRadio />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={async () => {
              await signOut();
              router.push('/sign-in');
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="bg-card/40 hidden w-60 shrink-0 flex-col border-r lg:flex">
        <Brand />
        <WorkspaceSwitcher />
        <NavLinks />
        <UserMenu />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center gap-2 border-b px-4 lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand onNavigate={() => setMobileOpen(false)} />
              <WorkspaceSwitcher onNavigate={() => setMobileOpen(false)} />
              <NavLinks onNavigate={() => setMobileOpen(false)} />
              <UserMenu />
            </SheetContent>
          </Sheet>
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            Palouse
          </Link>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShellInner>{children}</AppShellInner>
    </WorkspaceProvider>
  );
}
