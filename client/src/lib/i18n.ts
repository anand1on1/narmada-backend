// Lightweight dictionary-based i18n for Narmada portal + team.
// Language choice is persisted in localStorage.
// Usage:
//   const { t, lang, setLang } = useI18n();
//   t("dashboard") → "Dashboard" | "डैशबोर्ड"

const STORAGE_KEY = "narmada_lang";

export type Lang = "en" | "hi";

export const dictionary: Record<string, Record<Lang, string>> = {
  // Navigation
  dashboard: { en: "Dashboard", hi: "डैशबोर्ड" },
  quotations: { en: "Quotations", hi: "कोटेशन" },
  newQuotation: { en: "New Quotation", hi: "नया कोटेशन" },
  customers: { en: "Customers", hi: "ग्राहक" },
  partsMaster: { en: "Parts Master", hi: "पार्ट्स मास्टर" },
  logout: { en: "Logout", hi: "लॉग आउट" },
  profile: { en: "Profile", hi: "प्रोफाइल" },
  chat: { en: "Chat", hi: "चैट" },
  ledger: { en: "Ledger", hi: "बहीखाता" },
  rfqs: { en: "RFQs", hi: "आरएफक्यू" },
  quotes: { en: "Quotes", hi: "उद्धरण" },
  purchaseOrders: { en: "Purchase Orders", hi: "खरीद आदेश" },
  payments: { en: "Payments", hi: "भुगतान" },

  // Actions
  save: { en: "Save", hi: "सहेजें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  edit: { en: "Edit", hi: "संपादित करें" },
  delete: { en: "Delete", hi: "हटाएं" },
  approve: { en: "Approve", hi: "स्वीकृत करें" },
  reject: { en: "Reject", hi: "अस्वीकार करें" },
  submit: { en: "Submit", hi: "जमा करें" },
  search: { en: "Search", hi: "खोजें" },
  add: { en: "Add", hi: "जोड़ें" },
  close: { en: "Close", hi: "बंद करें" },
  back: { en: "Back", hi: "वापस" },
  next: { en: "Next", hi: "आगे" },

  // Quotation wizard
  selectCompany: { en: "Select Quoting Company", hi: "कोटिंग कंपनी चुनें" },
  selectCustomer: { en: "Select Customer", hi: "ग्राहक चुनें" },
  addItems: { en: "Add Items", hi: "आइटम जोड़ें" },
  currency: { en: "Currency", hi: "मुद्रा" },
  finish: { en: "Finish", hi: "समाप्त" },
  saveDraft: { en: "Save as Draft", hi: "ड्राफ्ट सहेजें" },
  saveFinalize: { en: "Save & Finalize", hi: "सहेजें और अंतिम करें" },
  manualEntry: { en: "Manual Entry", hi: "मैन्युअल प्रविष्टि" },
  importDocument: { en: "Import from Document", hi: "दस्तावेज़ से आयात करें" },

  // Portal
  customerPortal: { en: "Customer Portal", hi: "ग्राहक पोर्टल" },
  signIn: { en: "Sign In", hi: "साइन इन" },
  requestAccess: { en: "Request Access", hi: "पहुँच का अनुरोध करें" },
  myProfile: { en: "My Profile", hi: "मेरी प्रोफाइल" },
  chatAssistant: { en: "Chat Assistant", hi: "चैट सहायक" },

  // Status
  draft: { en: "Draft", hi: "ड्राफ्ट" },
  sent: { en: "Sent", hi: "भेजा गया" },
  accepted: { en: "Accepted", hi: "स्वीकृत" },
  expired: { en: "Expired", hi: "समाप्त" },
  pending: { en: "Pending", hi: "लंबित" },
  active: { en: "Active", hi: "सक्रिय" },
  inactive: { en: "Inactive", hi: "निष्क्रिय" },

  // Fields
  name: { en: "Name", hi: "नाम" },
  email: { en: "Email", hi: "ईमेल" },
  phone: { en: "Phone", hi: "फोन" },
  address: { en: "Address", hi: "पता" },
  company: { en: "Company", hi: "कंपनी" },
  total: { en: "Total", hi: "कुल" },
  date: { en: "Date", hi: "तारीख" },
  status: { en: "Status", hi: "स्थिति" },

  // Language
  language: { en: "Language", hi: "भाषा" },
  english: { en: "English", hi: "अंग्रेज़ी" },
  hindi: { en: "Hindi", hi: "हिंदी" },
};

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, val: string) {
  try { localStorage.setItem(key, val); } catch {}
}

let currentLang: Lang = (safeGet(STORAGE_KEY) as Lang) || "en";

// Listener registry for hook reactivity
const listeners = new Set<() => void>();

export function getLang(): Lang { return currentLang; }

export function setLang(lang: Lang) {
  currentLang = lang;
  safeSet(STORAGE_KEY, lang);
  listeners.forEach((fn) => fn());
}

export function t(key: string): string {
  const entry = dictionary[key];
  if (!entry) return key;
  return entry[currentLang] || entry["en"] || key;
}

// React hook
import { useState, useEffect, useCallback } from "react";

export function useI18n() {
  const [lang, setLangState] = useState<Lang>(currentLang);

  useEffect(() => {
    const listener = () => setLangState(currentLang);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const handleSetLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const translate = useCallback((key: string): string => {
    const entry = dictionary[key];
    if (!entry) return key;
    return entry[lang] || entry["en"] || key;
  }, [lang]);

  return { t: translate, lang, setLang: handleSetLang };
}
