import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthProvider } from "@/lib/admin-auth";
import { SiteLayout } from "@/components/SiteLayout";

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
  // Admin routes get a bare layout (no public nav/footer)
  if (location.startsWith("/admin")) {
    return (
      <Switch>
        <Route path="/admin" component={AdminLogin} />
        <Route path="/admin/dashboard" component={AdminDashboard} />
        <Route path="/admin/products" component={AdminProducts} />
        <Route path="/admin/contacts" component={AdminContacts} />
        <Route path="/admin/settings" component={AdminSettings} />
        <Route path="/admin/sitemap" component={AdminSitemap} />
        <Route component={NotFound} />
      </Switch>
    );
  }
  return <PublicRoutes />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AdminAuthProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AdminAuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
