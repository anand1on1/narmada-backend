import { z } from "zod";

export const BLOG_ORIGIN = "https://narmadamobility.com";
export const BLOG_EDITOR = "Narmada Mobility Editorial Desk";
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const bloggerSettingsSchema = z.object({
  mode: z.enum(["auto", "draft", "pause"]).default("auto"),
  morning: clock.default("09:00"),
  improvement: clock.default("13:00"),
  evening: clock.default("17:00"),
  dailyNewCap: z.literal(2).default(2),
  dailyImprovementCap: z.literal(1).default(1),
  dailyDraftCap: z.number().int().min(0).max(3).default(1),
  dailyCallBudget: z.number().int().min(3).max(36).default(18),
  dailyTokenBudget: z.number().int().min(60000).max(600000).default(300000),
  maxAttempts: z.number().int().min(1).max(3).default(3),
}).strict().refine(v => v.morning < v.improvement && v.improvement < v.evening,
  "Schedule must be morning < improvement < evening (Asia/Kolkata)");
export type BloggerSettings = z.infer<typeof bloggerSettingsSchema>;
export const articleDraftSchema = z.object({
  title: z.string().min(20).max(120),
  excerpt: z.string().min(50).max(200),
  content: z.string().min(1500).max(35000),
  metaTitle: z.string().min(15).max(65),
  metaDescription: z.string().min(60).max(165),
  // Each substantive factual claim must quote the supplied evidence verbatim.
  claims: z.array(z.object({
    claim: z.string().min(15).max(700),
    sourceUrl: z.string().url(),
    evidenceQuote: z.string().min(30).max(1200),
  }).strict()).min(2).max(15),
  productSlugs: z.array(z.string().regex(/^[a-zA-Z0-9_-]+$/)).max(5),
  improvementSummary: z.string().max(600).default(""),
  followUpTopics: z.array(z.object({
    title: z.string().min(30).max(140),
    sourceUrl: z.string().url(),
    evidenceQuote: z.string().min(30).max(500),
  }).strict()).max(3).default([]),
}).strict();
export type ArticleDraft = z.infer<typeof articleDraftSchema>;
export type BlogSource = {
  url: string; title: string; text: string; accessedAt: number;
};
export type CatalogFact = {
  id: number; slug: string; brand: string; category: string;
  partNumber?: string;
  // No free-text descriptions or private transaction values cross the boundary.
  demandBand: "historical-enquiries" | "catalog";
};
