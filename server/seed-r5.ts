// R5.2 idempotent boot seed: default company, warehouses, Delhi team users.
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "./storage";
import { companies, warehouses, dataTeamUsers } from "@shared/schema";
import { eq } from "drizzle-orm";

function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seedR5Defaults() {
  const now = Date.now();

  // ---- Company: NARMADA MOTORS (default) ----
  const existingCompanies = db.select().from(companies).all();
  if (existingCompanies.length === 0) {
    db.insert(companies).values({
      code: "NM",
      name: "NARMADA MOTORS",
      gstin: "10ASWPP6442P1ZZ",
      pan: "ASWPP6442P",
      addressLine1: "J-157, Priyamvada Apartment, Near Amrit Avi Hospital",
      addressLine2: "J Sector, Kankarbagh",
      city: "Patna",
      state: "Bihar",
      pincode: "800020",
      bankName: "ICICI",
      bankBranch: "Exhibition Road",
      accountNo: "625905053758",
      ifsc: "ICIC0006259",
      beneficiaryName: "NARMADA MOTORS",
      signatoryName: "Piyush Anand",
      signatoryPhone: "7909083806",
      signatoryEmail: "anand@narmadamotors.in",
      gstType: "regular",
      logoUrl: null,
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).run();
    console.log("[seed-r5] Seeded default company NARMADA MOTORS");
  }

  // ---- Warehouses: DEL + PAT ----
  const ensureWarehouse = (code: string, name: string, city: string) => {
    const exists = db.select().from(warehouses).where(eq(warehouses.code, code)).get();
    if (!exists) {
      db.insert(warehouses).values({ code, name, city, isActive: true, createdAt: now }).run();
      console.log(`[seed-r5] Seeded warehouse ${code}`);
    }
  };
  ensureWarehouse("DEL", "Delhi Warehouse", "Delhi");
  ensureWarehouse("PAT", "Patna HQ", "Patna");

  // ---- Delhi team users (role delhi_warehouse) ----
  const ensureDelhiUser = (username: string, name: string, phone: string) => {
    const exists = db.select().from(dataTeamUsers).where(eq(dataTeamUsers.username, username)).get();
    if (!exists) {
      db.insert(dataTeamUsers).values({
        username,
        passwordHash: hashPassword("Narmada@2026"),
        name,
        phone,
        role: "delhi_warehouse",
        active: true,
        createdAt: now,
      }).run();
      console.log(`[seed-r5] Seeded Delhi user ${username}`);
    }
  };
  ensureDelhiUser("919155596461", "Kundan Kumar", "919155596461");
  ensureDelhiUser("918602535661", "Aditya Pawar", "918602535661");
}
