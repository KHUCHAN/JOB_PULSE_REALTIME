"use client";

import {
  Activity,
  BellRing,
  BriefcaseBusiness,
  Building2,
  Gauge,
  Menu,
  Search,
  UserRoundSearch,
  X,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { useJobPulse } from "./fixture-provider";

const navigation = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/sources", label: "Sources", icon: Building2 },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/talent", label: "Talent Harness", icon: UserRoundSearch },
  { href: "/activity", label: "Activity", icon: Activity },
];

const subscribeToLocation = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};

const currentPathname = () => window.location.pathname;
const serverPathname = () => "/";

export function AppShell({ children }: { children: ReactNode }): ReactElement {
  const { demoMode } = useJobPulse();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useSyncExternalStore(subscribeToLocation, currentPathname, serverPathname);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            {/* The generated transparent PNG is already display-sized and served locally. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/job-pulse-logo.png" alt="" width="42" height="42" />
          </div>
          <div>
            <strong>Job Pulse</strong>
            <span>Realtime</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {navigation.map(({ href, label, icon: Icon }) => {
            const selected = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <a
                href={href}
                key={href}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="pulse-line" aria-hidden="true">
            <span />
          </div>
          <p>Personal workspace</p>
          <span>Automatic · every 2 hours</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>

          <div className="topbar-title">
            <strong>Job Pulse Realtime</strong>
            <span><i aria-hidden="true" /> Monitoring workspace</span>
          </div>

          <form className="global-search" action="/jobs" method="get">
            <Search size={17} aria-hidden="true" />
            <label className="sr-only" htmlFor="global-keyword">Search all jobs</label>
            <input id="global-keyword" name="q" placeholder="Search a keyword" />
          </form>

          <span className="demo-badge">{demoMode ? "Demo data" : "Live D1"}</span>
          <div className="batch-status" aria-label="Crawl schedule">
            <i aria-hidden="true" />
            <span><strong>Automatic</strong>Every 2 hours</span>
          </div>
        </header>

        <div className="mobile-search-row">
          <form className="global-search" action="/jobs" method="get">
            <Search size={17} aria-hidden="true" />
            <label className="sr-only" htmlFor="mobile-keyword">Search all jobs</label>
            <input id="mobile-keyword" name="q" placeholder="Search a keyword" />
          </form>
        </div>

        <main className="page-canvas">{children}</main>
      </section>
    </div>
  );
}
