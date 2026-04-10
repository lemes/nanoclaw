#!/usr/bin/env npx tsx
/**
 * Import Kivra receipt JSONs into a SQLite database for purchase analysis.
 * Idempotent — safe to re-run after new receipts are downloaded.
 *
 * Usage: npx tsx scripts/import-groceries.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(process.cwd(), 'groups', 'global', 'groceries.db');
const RECEIPTS_DIR = path.join(
  DATA_DIR,
  'kivra-receipts',
  '199110090090',
  'Receipts',
  'json',
);

// --- Schema ---

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  org_number TEXT
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  purchase_date TEXT NOT NULL,
  total_amount REAL NOT NULL,
  source_file TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL,
  unit TEXT,
  unit_price REAL,
  item_type TEXT NOT NULL DEFAULT 'product'
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id INTEGER NOT NULL REFERENCES line_items(id),
  description TEXT NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS product_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product_category_map (
  normalized_name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES product_categories(id),
  confidence REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (normalized_name, category_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(purchase_date);
CREATE INDEX IF NOT EXISTS idx_receipts_store ON receipts(store_id);
CREATE INDEX IF NOT EXISTS idx_line_items_receipt ON line_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_line_items_normalized ON line_items(normalized_name);
CREATE INDEX IF NOT EXISTS idx_discounts_line_item ON discounts(line_item_id);
`;

// --- Parsers ---

function parseSwedishMoney(formatted: string): number {
  // "71,60 kr" → 71.60 | "−6,98 kr" → -6.98
  const cleaned = formatted
    .replace(/\u00a0/g, ' ') // non-breaking space
    .replace(/\u2212/g, '-') // unicode minus
    .replace(/kr/g, '')
    .trim()
    .replace(/,/g, '.');
  return parseFloat(cleaned);
}

function parseQuantityCost(
  qc: { formatted: string } | null | undefined,
): { quantity: number; unit: string; unitPrice: number } | null {
  if (!qc?.formatted) return null;
  // "0,405 kg * 12,95 kr/kg" or "2 st * 9,90 kr/st"
  const m = qc.formatted.match(
    /^([\d,]+)\s+(kg|st)\s*\*\s*([\d,]+)\s+kr\/(kg|st)$/,
  );
  if (!m) return null;
  return {
    quantity: parseFloat(m[1].replace(',', '.')),
    unit: m[2],
    unitPrice: parseFloat(m[3].replace(',', '.')),
  };
}

function normalizeName(name: string): string {
  return name.replace(/^\*+/, '').trim().toLowerCase();
}

// --- Store extraction ---

interface StoreInfo {
  name: string;
  address: string | null;
  orgNumber: string | null;
}

function extractStoreInfo(receipt: any): StoreInfo {
  const headerName = (receipt.content.header.text?.[0] || '').trim();
  const storeInfoEntries =
    receipt.content.storeInformation?.storeInformation || [];

  let address: string | null = null;
  let orgNumber: string | null = null;

  for (const entry of storeInfoEntries) {
    if (entry.property === 'Adress') {
      const parts = [entry.value];
      for (const sub of entry.subRows || []) {
        if (sub.value) parts.push(sub.value);
      }
      address = parts.filter(Boolean).join(', ');
    }
    if (entry.property === 'Organisationsnummer' && entry.value) {
      orgNumber = entry.value;
    }
  }

  // First storeInfo entry is typically the store name for ICA.
  // For pharmacies it's the address, so fall back to header text.
  let name = headerName;
  if (
    storeInfoEntries.length > 0 &&
    storeInfoEntries[0].property &&
    storeInfoEntries[0].property !== address?.split(',')[0]
  ) {
    const candidate = storeInfoEntries[0].property;
    // Only use it if it doesn't look like an address (no digits at start)
    if (!/^\d/.test(candidate)) {
      name = candidate;
    }
  }

  return { name: name || 'Unknown', address, orgNumber };
}

// --- Main ---

async function main() {
  const jsonFiles = fs
    .readdirSync(RECEIPTS_DIR, { recursive: true })
    .map((f) => path.join(RECEIPTS_DIR, f.toString()))
    .filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.log('No JSON files found in', RECEIPTS_DIR);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Prepared statements
  const checkReceipt = db.prepare('SELECT 1 FROM receipts WHERE key = ?');
  const insertStore = db.prepare(
    'INSERT OR IGNORE INTO stores (name, address, org_number) VALUES (?, ?, ?)',
  );
  const getStoreId = db.prepare('SELECT id FROM stores WHERE name = ?');
  const insertReceipt = db.prepare(
    'INSERT INTO receipts (key, store_id, purchase_date, total_amount, source_file) VALUES (?, ?, ?, ?, ?)',
  );
  const insertLineItem = db.prepare(
    'INSERT INTO line_items (receipt_id, name, normalized_name, price, quantity, unit, unit_price, item_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertDiscount = db.prepare(
    'INSERT INTO discounts (line_item_id, description, amount) VALUES (?, ?, ?)',
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let totalItems = 0;

  const importAll = db.transaction(() => {
    for (const filePath of jsonFiles) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const receipt = JSON.parse(raw);

        // Idempotency check
        if (checkReceipt.get(receipt.key)) {
          skipped++;
          continue;
        }

        // Store
        const store = extractStoreInfo(receipt);
        insertStore.run(store.name, store.address, store.orgNumber);
        const storeRow = getStoreId.get(store.name) as { id: number };

        // Receipt
        const totalAmount = parseSwedishMoney(
          receipt.content.header.totalPurchaseAmount,
        );
        const result = insertReceipt.run(
          receipt.key,
          storeRow.id,
          receipt.content.header.isoDate,
          totalAmount,
          path.relative(RECEIPTS_DIR, filePath),
        );
        const receiptId = result.lastInsertRowid;

        // Line items from allItems
        const allItems = receipt.content.items?.allItems?.items || [];
        for (const item of allItems) {
          if (item.type === 'text') continue;

          const itemName =
            item.type === 'general_deposit'
              ? item.description || 'Pant'
              : item.name || 'Unknown';
          const price = parseSwedishMoney(item.money.formatted);
          const qc = parseQuantityCost(item.quantityCost);

          const lineResult = insertLineItem.run(
            receiptId,
            itemName,
            normalizeName(itemName),
            price,
            qc?.quantity ?? null,
            qc?.unit ?? null,
            qc?.unitPrice ?? null,
            item.type || 'product',
          );
          const lineItemId = lineResult.lastInsertRowid;
          totalItems++;

          // Discounts (costModifiers)
          for (const mod of item.costModifiers || []) {
            insertDiscount.run(
              lineItemId,
              mod.description,
              parseSwedishMoney(mod.money.formatted),
            );
          }
        }

        imported++;
      } catch (err) {
        errors++;
        console.error(`Error processing ${path.basename(filePath)}:`, err);
      }
    }
  });

  importAll();

  console.log(`Import done.`);
  console.log(`  Receipts imported: ${imported}`);
  console.log(`  Receipts skipped (already in DB): ${skipped}`);
  console.log(`  Line items: ${totalItems}`);
  console.log(`  Errors: ${errors}`);

  // --- Classification of new products ---
  await classifyNewProducts(db);

  console.log(`  Database: ${DB_PATH}`);
  db.close();
}

// --- Classification ---

const CATEGORIES = [
  'Vegetables', 'Fruit', 'Dairy', 'Bread & Bakery', 'Meat & Fish',
  'Beverages', 'Pantry & Dry Goods', 'Frozen', 'Snacks & Sweets',
  'Condiments & Sauces', 'Household', 'Health & Pharmacy', 'Baby', 'Other',
];
const CLASSIFY_BATCH_SIZE = 100;
const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001';

function loadApiKey(): string | null {
  // 1. Environment variable
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // 2. Host-only config file
  try {
    const keyPath = path.join(os.homedir(), '.config', 'nanoclaw', 'anthropic-api-key');
    return fs.readFileSync(keyPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function classifyBatch(
  client: Anthropic,
  products: string[],
): Promise<Record<string, string>> {
  const productList = products.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const response = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Classify these Swedish grocery product names into exactly one category each.

Categories: ${CATEGORIES.join(', ')}

Products:
${productList}

Return ONLY a JSON object mapping each product name (exactly as given) to its category. No explanation, no markdown fences. Example: {"gul lök ica": "Vegetables", "smörcroissant": "Bread & Bakery"}`,
    }],
  });
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};
  try { return JSON.parse(jsonMatch[0]); } catch { return {}; }
}

async function classifyNewProducts(db: Database.Database) {
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.log('  Classification skipped (no API key found).');
    return;
  }

  // Seed categories
  const insertCat = db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)');
  for (const cat of CATEGORIES) insertCat.run(cat);

  // Find unclassified products
  const unclassified = (db.prepare(
    `SELECT DISTINCT li.normalized_name FROM line_items li
     WHERE li.item_type = 'product'
       AND li.normalized_name NOT IN (SELECT normalized_name FROM product_category_map)
     ORDER BY li.normalized_name`
  ).all() as { normalized_name: string }[]).map(r => r.normalized_name);

  if (unclassified.length === 0) {
    console.log('  Classification: all products already classified.');
    return;
  }

  console.log(`  Classifying ${unclassified.length} new products...`);

  const client = new Anthropic({ apiKey });
  const categoryRows = db.prepare('SELECT id, name FROM product_categories').all() as { id: number; name: string }[];
  const categoryMap = new Map(categoryRows.map(r => [r.name, r.id]));
  const insertMapping = db.prepare(
    'INSERT OR REPLACE INTO product_category_map (normalized_name, category_id, confidence, source) VALUES (?, ?, ?, \'llm\')'
  );

  let classified = 0;
  for (let i = 0; i < unclassified.length; i += CLASSIFY_BATCH_SIZE) {
    const batch = unclassified.slice(i, i + CLASSIFY_BATCH_SIZE);
    try {
      const results = await classifyBatch(client, batch);
      const insertBatch = db.transaction(() => {
        for (const [product, category] of Object.entries(results)) {
          const catId = categoryMap.get(category)
            ?? categoryMap.get(CATEGORIES.find(c => c.toLowerCase() === category.toLowerCase()) || '')
            ?? categoryMap.get('Other');
          if (catId) { insertMapping.run(product, catId, 0.9); classified++; }
        }
      });
      insertBatch();
    } catch (err: any) {
      console.error(`  Classification batch failed:`, err?.message || err);
      if (err?.status === 401) { console.error('  Auth failed — check API key.'); break; }
    }
  }
  console.log(`  Classified: ${classified} products.`);
}

main();
