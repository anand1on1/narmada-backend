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
import AdminBank from "@/pages/admin/AdminBank";
// Session C — new admin pages
import AdminQuotingCompanies from "@/pages/admin/AdminQuotingCompanies";
import AdminDataTeam from "@/pages/admin/AdminDataTeam";
import AdminAuditLog from "@/pages/admin/AdminAuditLog";
import AdminNotificationLog from "@/pages/admin/AdminNotificationLog";
import AdminAccountRequests from "@/pages/admin/AdminAccountRequests";

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
        <Route path="/admin/purchase-orders" component={AdminPOs} />
        <Route path="/admin/bank" component={AdminBank} />
        {/* Session C — new admin routes */}
        <Route path="/admin/quoting-companies" component={AdminQuotingCompanies} />
        <Route path="/admin/data-team" component={AdminDataTeam} />
        <Route path="/admin/audit-logs" component={AdminAuditLog} />
        <Route path="/admin/notification-log" component={AdminNotificationLog} />
        <Route path="/admin/account-requests" component={AdminAccountRequests} />
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
        <Route path="/team/parts" component={TeamParts} />
        <Route component={NotFound} />
      </Switch>
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
