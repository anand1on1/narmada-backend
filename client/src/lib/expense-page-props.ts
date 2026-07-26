// R27.36-FIX-1 — the three R27.36 expense pages are rendered by three different
// portals (team panel, admin panel, finance portal) that each carry their own token
// and their own chrome. All three fetch helpers already share one signature, so the
// pages take the auth pair and the layout as props instead of importing one portal's
// helpers directly. Mirrors the existing <SalesExpenseApprovals token fetcher /> pattern.
import type { ComponentType, ReactNode } from "react";

export type PortalFetcher = (token: string | null, url: string, init?: RequestInit) => Promise<Response>;

export type PortalLayout = ComponentType<{ title: string; children: ReactNode }>;

export interface ExpensePageProps {
  token: string | null;
  fetcher: PortalFetcher;
  Layout: PortalLayout;
}
