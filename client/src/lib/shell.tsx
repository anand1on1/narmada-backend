// v1.4a — Shell context. Lets the SAME page components render under either the
// Admin shell or the Data Center shell. The layout route provides the shell via
// <ShellProvider>; pages read it through useShellAuth()/ShellLayout and transparently
// attach the correct auth token (x-admin-token vs x-datacenter-token) and hide
// delete affordances for Data Center users.
import { createContext, useContext, ReactNode } from "react";
import { AdminLayout } from "@/pages/admin/AdminLayout";
import { DataCenterLayout } from "@/pages/datacenter/DataCenterLayout";
import { useAdminAuth, adminFetch, type AdminRole } from "@/lib/admin-auth";
import { useDataCenterAuth, dcFetch } from "@/hooks/useDataCenterAuth";

export type Shell = "admin" | "datacenter";

const ShellCtx = createContext<Shell>("admin");

export function ShellProvider({ shell, children }: { shell: Shell; children: ReactNode }) {
  return <ShellCtx.Provider value={shell}>{children}</ShellCtx.Provider>;
}

export function useShell(): Shell {
  return useContext(ShellCtx);
}

export interface ShellAuth {
  shell: Shell;
  token: string | null;
  username: string | null;
  role: AdminRole | null;
  displayName: string | null;
  ready: boolean;
  // Same signature as the legacy adminFetch so existing call sites work unchanged.
  adminFetch: (token: string | null, url: string, init?: RequestInit) => Promise<Response>;
  // Header object for manual multipart uploads (which can't use adminFetch's JSON default).
  uploadHeaders: Record<string, string>;
  // Data Center users never see delete affordances.
  hideDelete: boolean;
}

export function useShellAuth(): ShellAuth {
  const shell = useShell();
  const admin = useAdminAuth();
  const dc = useDataCenterAuth();

  if (shell === "datacenter") {
    return {
      shell,
      token: dc.token,
      username: dc.username,
      role: "data_center",
      displayName: dc.displayName,
      ready: dc.ready,
      adminFetch: (_t, url, init) => dcFetch(dc.token, url, init),
      uploadHeaders: dc.token ? { "x-datacenter-token": dc.token } : {},
      hideDelete: true,
    };
  }
  return {
    shell,
    token: admin.token,
    username: admin.username,
    role: admin.role,
    displayName: admin.displayName,
    ready: admin.ready,
    adminFetch: (_t, url, init) => adminFetch(admin.token, url, init),
    uploadHeaders: admin.token ? { "x-admin-token": admin.token } : {},
    hideDelete: admin.role === "data_center",
  };
}

// ShellLayout — renders the correct chrome for the active shell. Pages import this
// instead of AdminLayout so they slot into either app unchanged.
export function ShellLayout({ children, title }: { children: ReactNode; title: string }) {
  const shell = useShell();
  if (shell === "datacenter") return <DataCenterLayout title={title}>{children}</DataCenterLayout>;
  return <AdminLayout title={title}>{children}</AdminLayout>;
}
