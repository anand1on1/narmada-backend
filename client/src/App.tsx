import { useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthProvider } from "@/lib/admin-auth";
import { SiteLayout } from "@/components/SiteLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import HomePage from "@/pages/HomePage";
import ProductsPage from "@/pages/ProductsPage";
import ProductDetailPage from "@/pages/ProductDetailPage";
import ContactPage from "@/pages/ContactPage";
import AboutPage from "@/pages/AboutPage";
import WorkWithUsPage from "@/pages/WorkWithUsPage";
import PrivacyPage from "@/pages/PrivacyPage";
import DisclaimerPage from "@/pages/DisclaimerPage";
import CategoryPage from "@/pages/CategoryPage";
import SeoLandingPage from "@/pages/SeoLandingPage";
import BrandPage from "@/pages/BrandPage";
import BlogList from "@/pages/BlogList";
import BlogDetail from "@/pages/BlogDetail";
import PriceChecker from "@/pages/PriceChecker";
import TrackConsignment from "@/pages/TrackConsignment";
import { useParams } from "wouter";

// R10 — the old PO "Assign" page was merged into the detail page. Redirect the
// legacy /:id/edit URL to the merged /:id page.
function PoEditRedirect() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  navigate(`/team/purchase-orders/${id}`, { replace: true });
  return null;
}

// R24.1 — AI Discovery rebranded to Market Radar; redirect the legacy URL.
function MarketRadarRedirect() {
  const [, navigate] = useLocation();
  navigate("/admin/market-radar", { replace: true });
  return null;
}

// R26.4 — Marketing hub root redirects to the campaigns list.
// R26.6a (8) — when opened with ?compose=1 (from a lead card), forward to the campaign
// composer and preserve the query string so it can preset channel + targeted lead.
function MarketingRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const qIndex = window.location.hash.indexOf("?");
    const query = qIndex === -1 ? "" : window.location.hash.slice(qIndex);
    const params = new URLSearchParams(query.slice(1));
    if (params.get("compose") === "1") navigate(`/admin/marketing/campaigns/new${query}`, { replace: true });
    else navigate("/admin/marketing/campaigns", { replace: true });
  }, [navigate]);
  return null;
}

function SeoLandingResolver() {
  const { slug } = useParams<{ slug: string }>();
  const m = /^([a-z0-9-]+?)-spare-parts-(.+)$/i.exec(slug);
  if (!m) return <NotFound />;
  // re-render SeoLandingPage with the parsed params via window.location hash navigation
  // simpler: pass parsed values down via a context-free wrapper component
  return <SeoLandingPage __brand={m[1]} __location={m[2]} />;
}

import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import AdminProducts from "@/pages/admin/AdminProducts";
import AdminContacts from "@/pages/admin/AdminContacts";
import AdminSettings from "@/pages/admin/AdminSettings";
import AdminSitemap from "@/pages/admin/AdminSitemap";
import AdminBlog from "@/pages/admin/AdminBlog";
import AdminPriceList from "@/pages/admin/AdminPriceList";
import AdminConsignments from "@/pages/admin/AdminConsignments";
import AdminTeam from "@/pages/admin/AdminTeam";
import AdminCustomers from "@/pages/admin/AdminCustomers";
import AdminLedger from "@/pages/admin/AdminLedger";
import AdminPayments from "@/pages/admin/AdminPayments";
import AdminRFQs from "@/pages/admin/AdminRFQs";
import AdminQuotes from "@/pages/admin/AdminQuotes";
import AdminPOs from "@/pages/admin/AdminPOs";
import AdminPODetailV2 from "@/pages/admin/AdminPODetailV2";
import AdminBank from "@/pages/admin/AdminBank";
// Session C — new admin pages
import AdminQuotingCompanies from "@/pages/admin/AdminQuotingCompanies";
import AdminDataTeam from "@/pages/admin/AdminDataTeam";
import AdminAuditLog from "@/pages/admin/AdminAuditLog";
import AdminNotificationLog from "@/pages/admin/AdminNotificationLog";
import AdminAccountRequests from "@/pages/admin/AdminAccountRequests";
// Rounds 4.4–7 — new admin pages
import AdminVendors from "@/pages/admin/AdminVendors";
import AdminVendorLedger from "@/pages/admin/AdminVendorLedger";
import AdminCompanies from "@/pages/admin/AdminCompanies";
import AdminAILedger from "@/pages/admin/AdminAILedger";
import AdminLeads from "@/pages/admin/AdminLeads";
import AdminVendorInbox from "@/pages/admin/AdminVendorInbox";
import AdminVendorDiscovery from "@/pages/admin/AdminVendorDiscovery";
import AdminTargets from "@/pages/admin/AdminTargets";
import AdminAnnouncements from "@/pages/admin/AdminAnnouncements";
import AdminTasks from "@/pages/admin/AdminTasks";
import AdminAdsMeta from "@/pages/admin/AdminAdsMeta";
import AdminAdsGoogle from "@/pages/admin/AdminAdsGoogle";
import AdminIntegrations from "@/pages/admin/AdminIntegrations";
// Round 8 — new admin pages
import AdminParts from "@/pages/admin/AdminParts";
import AdminPurchaseHistory from "@/pages/admin/AdminPurchaseHistory";
// R23/R24 — Command Center + WhatsApp-web Chats
import AdminCommandCenter from "@/pages/admin/AdminCommandCenter";
import AdminChats from "@/pages/admin/AdminChats";
// R26.4 — Marketing Hub
import AdminMarketingCampaigns from "@/pages/admin/AdminMarketingCampaigns";
import AdminMarketingCampaignComposer from "@/pages/admin/AdminMarketingCampaignComposer";
import AdminMarketingCampaignDetail from "@/pages/admin/AdminMarketingCampaignDetail";
import AdminMarketingAudiences from "@/pages/admin/AdminMarketingAudiences";
import AdminMarketingTemplates from "@/pages/admin/AdminMarketingTemplates";
// R26.5 — Marketing custom WhatsApp templates
import AdminMarketingCustomTemplates from "@/pages/admin/AdminMarketingCustomTemplates";
// R26.5 — V2 admin pages (canonical Leads/Tasks, Create Users)
import AdminLeadsV2 from "@/pages/admin/AdminLeadsV2";
import AdminTasksV2 from "@/pages/admin/AdminTasksV2";
import AdminUsers from "@/pages/admin/AdminUsers";

// R26.5 — Sales/Finance/HR/Consignment role portals
import { SalesAuth, FinanceAuth, HRAuth, ConsignmentAuth } from "@/lib/role-auth";
import SalesLogin from "@/pages/roles/SalesLogin";
import SalesDashboard from "@/pages/roles/SalesDashboard";
import FinanceLogin from "@/pages/roles/FinanceLogin";
import FinanceDashboard from "@/pages/roles/FinanceDashboard";
import HRLogin from "@/pages/roles/HRLogin";
import HRDashboard from "@/pages/roles/HRDashboard";
import ConsignmentLogin from "@/pages/roles/ConsignmentLogin";
import ConsignmentDashboard from "@/pages/roles/ConsignmentDashboard";

import { CustomerAuthProvider } from "@/lib/customer-auth";
import CustomerLogin from "@/pages/portal/CustomerLogin";
import CustomerDashboard from "@/pages/portal/CustomerDashboard";
import CustomerLedger from "@/pages/portal/CustomerLedger";
import CustomerRFQs from "@/pages/portal/CustomerRFQs";
import CustomerQuotes from "@/pages/portal/CustomerQuotes";
import CustomerPOs from "@/pages/portal/CustomerPOs";
import CustomerPayments from "@/pages/portal/CustomerPayments";
// Session C — new portal pages
import PortalProfile from "@/pages/portal/PortalProfile";
import PortalChat from "@/pages/portal/PortalChat";
import PortalRegister from "@/pages/portal/PortalRegister";

// Session C — Team portal
import { TeamAuthProvider } from "@/lib/team-auth";
import TeamLogin from "@/pages/team/TeamLogin";
import TeamDashboard from "@/pages/team/TeamDashboard";
import TeamQuotations from "@/pages/team/TeamQuotations";
import TeamQuotationNew from "@/pages/team/TeamQuotationNew";
import TeamQuotationEdit from "@/pages/team/TeamQuotationEdit";
import TeamParts from "@/pages/team/TeamParts";
import TeamCustomers from "@/pages/team/TeamCustomers";
import TeamSellers from "@/pages/team/TeamSellers";
// Rounds 4.4–7 — team PO/RFQ pages
import TeamPOs from "@/pages/team/TeamPOs";
import TeamPODetail from "@/pages/team/TeamPODetail";
import TeamRFQs from "@/pages/team/TeamRFQs";
import TeamRFQDetail from "@/pages/team/TeamRFQDetail";
// Round 8 — new team pages
import TeamPOUpload from "@/pages/team/TeamPOUpload";
// R12 — data-team seller chat hub
import TeamChats from "@/pages/team/TeamChats";
// Delhi warehouse portal
import DelhiLogin from "@/pages/delhi/DelhiLogin";
import DelhiDashboard from "@/pages/delhi/DelhiDashboard";
// R12 — Delhi PO-centric detail
import DelhiPODetail from "@/pages/delhi/DelhiPODetail";

import NotFound from "@/pages/not-found";

function PublicRoutes() {
  return (
    <SiteLayout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/products" component={ProductsPage} />
        <Route path="/product/:slug" component={ProductDetailPage} />
        <Route path="/category/:slug" component={CategoryPage} />
        <Route path="/contact" component={ContactPage} />
        <Route path="/about" component={AboutPage} />
        <Route path="/work-with-us" component={WorkWithUsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/disclaimer" component={DisclaimerPage} />
        {/* Phase 3 — registered BEFORE catch-all /:slug */}
        <Route path="/blog" component={BlogList} />
        <Route path="/blog/:slug" component={BlogDetail} />
        <Route path="/price-checker" component={PriceChecker} />
        <Route path="/track-consignment/:docket" component={TrackConsignment} />
        <Route path="/track-consignment" component={TrackConsignment} />
        {/* Individual brand pages — MUST be before catch-all /:slug */}
        <Route path="/brand/:slug" component={BrandPage} />
        {/* SEO landing pages: /:brand-spare-parts-:location */}
        <Route path="/:slug" component={SeoLandingResolver} />
        <Route component={NotFound} />
      </Switch>
    </SiteLayout>
  );
}

function AppRouter() {
  const [location] = useLocation();
  // Per-route boundary: a render crash in one page shows a recoverable screen
  // (Go back / Reload) instead of a blank white page. Keyed by location so a
  // crashed page clears its error state once the user navigates elsewhere.
  // Admin routes get a bare layout (no public nav/footer)
  if (location.startsWith("/admin")) {
    return (
      <ErrorBoundary key={location} label="admin">
      <Switch>
        <Route path="/admin" component={AdminLogin} />
        <Route path="/admin/dashboard" component={AdminDashboard} />
        <Route path="/admin/products" component={AdminProducts} />
        <Route path="/admin/contacts" component={AdminContacts} />
        <Route path="/admin/settings" component={AdminSettings} />
        <Route path="/admin/sitemap" component={AdminSitemap} />
        <Route path="/admin/blog" component={AdminBlog} />
        <Route path="/admin/price-lists" component={AdminPriceList} />
        <Route path="/admin/consignments" component={AdminConsignments} />
        <Route path="/admin/team" component={AdminTeam} />
        <Route path="/admin/customers" component={AdminCustomers} />
        <Route path="/admin/ledger" component={AdminLedger} />
        <Route path="/admin/payments" component={AdminPayments} />
        <Route path="/admin/rfqs" component={AdminRFQs} />
        <Route path="/admin/quotes" component={AdminQuotes} />
        {/* R26.6a (5) — admin PO detail page (was a 404). Must precede the list route. */}
        <Route path="/admin/purchase-orders-v2/:id" component={AdminPODetailV2} />
        <Route path="/admin/purchase-orders" component={AdminPOs} />
        <Route path="/admin/bank" component={AdminBank} />
        {/* Session C — new admin routes */}
        <Route path="/admin/quoting-companies" component={AdminQuotingCompanies} />
        <Route path="/admin/data-team" component={AdminDataTeam} />
        <Route path="/admin/audit-logs" component={AdminAuditLog} />
        <Route path="/admin/notification-log" component={AdminNotificationLog} />
        <Route path="/admin/account-requests" component={AdminAccountRequests} />
        {/* Rounds 4.4–7 — new admin routes */}
        <Route path="/admin/vendors" component={AdminVendors} />
        <Route path="/admin/vendor-ledger" component={AdminVendorLedger} />
        <Route path="/admin/companies" component={AdminCompanies} />
        <Route path="/admin/ai-ledger" component={AdminAILedger} />
        {/* R26.5 — Leads V2 is now canonical at /admin/leads; old page kept at -legacy */}
        <Route path="/admin/leads-legacy" component={AdminLeads} />
        <Route path="/admin/leads" component={AdminLeadsV2} />
        <Route path="/admin/vendor-inbox" component={AdminVendorInbox} />
        <Route path="/admin/vendor-discovery" component={AdminVendorDiscovery} />
        <Route path="/admin/targets" component={AdminTargets} />
        <Route path="/admin/announcements" component={AdminAnnouncements} />
        {/* R26.5 — Tasks V2 is now canonical at /admin/tasks; old page kept at -legacy */}
        <Route path="/admin/tasks-legacy" component={AdminTasks} />
        <Route path="/admin/tasks" component={AdminTasksV2} />
        {/* R26.5 — Create Users + Sales Targets + Attendance */}
        <Route path="/admin/users" component={AdminUsers} />
        <Route path="/admin/ads-meta" component={AdminAdsMeta} />
        <Route path="/admin/ads-google" component={AdminAdsGoogle} />
        {/* R26.3b — OAuth Integrations panel */}
        <Route path="/admin/integrations" component={AdminIntegrations} />
        {/* Round 8 — new admin routes */}
        <Route path="/admin/parts" component={AdminParts} />
        <Route path="/admin/purchase-history" component={AdminPurchaseHistory} />
        {/* R23.1 — owner Command Center */}
        <Route path="/admin/command-center" component={AdminCommandCenter} />
        {/* R24.4 — WhatsApp-web style Chats */}
        <Route path="/admin/chats" component={AdminChats} />
        {/* R26.4 — Marketing Hub (new BEFORE :id to avoid shadowing) */}
        <Route path="/admin/marketing" component={MarketingRedirect} />
        <Route path="/admin/marketing/campaigns/new" component={AdminMarketingCampaignComposer} />
        <Route path="/admin/marketing/campaigns/:id" component={AdminMarketingCampaignDetail} />
        <Route path="/admin/marketing/campaigns" component={AdminMarketingCampaigns} />
        <Route path="/admin/marketing/audiences" component={AdminMarketingAudiences} />
        <Route path="/admin/marketing/custom-templates" component={AdminMarketingCustomTemplates} />
        <Route path="/admin/marketing/templates" component={AdminMarketingTemplates} />
        {/* R24.1 — Market Radar rebrand (vendor-discovery → market-radar, keep old URL working) */}
        <Route path="/admin/market-radar" component={AdminVendorDiscovery} />
        <Route path="/admin/discovery" component={MarketRadarRedirect} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    );
  }
  if (location.startsWith("/delhi")) {
    return (
      <ErrorBoundary key={location} label="delhi">
      <Switch>
        <Route path="/delhi" component={DelhiLogin} />
        <Route path="/delhi/login" component={DelhiLogin} />
        <Route path="/delhi/dashboard" component={DelhiDashboard} />
        <Route path="/delhi/po/:id" component={DelhiPODetail} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    );
  }
  if (location.startsWith("/portal")) {
    return (
      <ErrorBoundary key={location} label="portal">
      <Switch>
        <Route path="/portal" component={CustomerLogin} />
        {/* Session C — public register route (no auth required, before other portal routes) */}
        <Route path="/portal/register" component={PortalRegister} />
        <Route path="/portal/dashboard" component={CustomerDashboard} />
        <Route path="/portal/ledger" component={CustomerLedger} />
        <Route path="/portal/rfqs" component={CustomerRFQs} />
        <Route path="/portal/quotes" component={CustomerQuotes} />
        <Route path="/portal/purchase-orders" component={CustomerPOs} />
        <Route path="/portal/payments" component={CustomerPayments} />
        {/* Session C — new portal routes */}
        <Route path="/portal/profile" component={PortalProfile} />
        <Route path="/portal/chat" component={PortalChat} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    );
  }
  if (location.startsWith("/team")) {
    return (
      <ErrorBoundary key={location} label="team">
      <Switch>
        <Route path="/team" component={TeamLogin} />
        <Route path="/team/login" component={TeamLogin} />
        <Route path="/team/dashboard" component={TeamDashboard} />
        <Route path="/team/quotations/new" component={TeamQuotationNew} />
        <Route path="/team/quotations/:id" component={TeamQuotationEdit} />
        <Route path="/team/quotations" component={TeamQuotations} />
        <Route path="/team/customers" component={TeamCustomers} />
        <Route path="/team/sellers" component={TeamSellers} />
        <Route path="/team/parts" component={TeamParts} />
        {/* R10 — merged View+Assign; legacy /edit redirects to /:id */}
        <Route path="/team/purchase-orders/:id/edit" component={PoEditRedirect} />
        <Route path="/team/purchase-orders/:id" component={TeamPODetail} />
        <Route path="/team/purchase-orders" component={TeamPOs} />
        <Route path="/team/rfqs/:id" component={TeamRFQDetail} />
        <Route path="/team/rfqs" component={TeamRFQs} />
        {/* R12 — seller chat hub */}
        <Route path="/team/chats" component={TeamChats} />
        {/* Round 8 — upload route */}
        <Route path="/team/po/upload" component={TeamPOUpload} />
        <Route component={NotFound} />
      </Switch>
      </ErrorBoundary>
    );
  }
  // R26.5 — Sales rep portal
  if (location.startsWith("/sales")) {
    return (
      <ErrorBoundary key={location} label="sales">
        <SalesAuth.Provider>
          <Switch>
            <Route path="/sales" component={SalesLogin} />
            <Route path="/sales/login" component={SalesLogin} />
            <Route path="/sales/dashboard" component={SalesDashboard} />
            <Route component={NotFound} />
          </Switch>
        </SalesAuth.Provider>
      </ErrorBoundary>
    );
  }
  // R26.5 — Finance portal (stub dashboard)
  if (location.startsWith("/finance")) {
    return (
      <ErrorBoundary key={location} label="finance">
        <FinanceAuth.Provider>
          <Switch>
            <Route path="/finance" component={FinanceLogin} />
            <Route path="/finance/login" component={FinanceLogin} />
            <Route path="/finance/dashboard" component={FinanceDashboard} />
            <Route component={NotFound} />
          </Switch>
        </FinanceAuth.Provider>
      </ErrorBoundary>
    );
  }
  // R26.5 — HR portal (stub dashboard)
  if (location.startsWith("/hr")) {
    return (
      <ErrorBoundary key={location} label="hr">
        <HRAuth.Provider>
          <Switch>
            <Route path="/hr" component={HRLogin} />
            <Route path="/hr/login" component={HRLogin} />
            <Route path="/hr/dashboard" component={HRDashboard} />
            <Route component={NotFound} />
          </Switch>
        </HRAuth.Provider>
      </ErrorBoundary>
    );
  }
  // R26.5 — Consignment portal
  if (location.startsWith("/consignment")) {
    return (
      <ErrorBoundary key={location} label="consignment">
        <ConsignmentAuth.Provider>
          <Switch>
            <Route path="/consignment" component={ConsignmentLogin} />
            <Route path="/consignment/login" component={ConsignmentLogin} />
            <Route path="/consignment/dashboard" component={ConsignmentDashboard} />
            <Route component={NotFound} />
          </Switch>
        </ConsignmentAuth.Provider>
      </ErrorBoundary>
    );
  }
  return (
    <ErrorBoundary key={location} label="public">
      <PublicRoutes />
    </ErrorBoundary>
  );
}

function App() {
  // R26.6a (11) — scroll the window to the top on every hash route change so a
  // long admin/sales/consignment page doesn't open scrolled mid-way down.
  useEffect(() => {
    const onHash = () => window.scrollTo({ top: 0, behavior: "smooth" });
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <ErrorBoundary label="root">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminAuthProvider>
            <CustomerAuthProvider>
              <TeamAuthProvider>
                <Toaster />
                <Router hook={useHashLocation}>
                  <AppRouter />
                </Router>
              </TeamAuthProvider>
            </CustomerAuthProvider>
          </AdminAuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
