#!/usr/bin/env npx tsx
/**
 * Classify grocery products into categories using Claude API.
 * Reads unique product names from groceries.db, sends them in batches
 * to Claude Haiku for classification, and writes results to product_category_map.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... npx tsx scripts/classify-products.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'groceries.db');
const BATCH_SIZE = 100;
const MODEL = 'claude-haiku-4-5-20251001';

const CATEGORIES = [
  'Vegetables',
  'Fruit',
  'Dairy',
  'Bread & Bakery',
  'Meat & Fish',
  'Beverages',
  'Pantry & Dry Goods',
  'Frozen',
  'Snacks & Sweets',
  'Condiments & Sauces',
  'Household',
  'Health & Pharmacy',
  'Baby',
  'Other',
];

function setupDb(db: Database.Database) {
  // Ensure categories exist
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO product_categories (name) VALUES (?)',
  );
  for (const cat of CATEGORIES) {
    insertCat.run(cat);
  }
}

function getUnclassifiedProducts(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT li.normalized_name
       FROM line_items li
       WHERE li.item_type = 'product'
         AND li.normalized_name NOT IN (SELECT normalized_name FROM product_category_map)
       ORDER BY li.normalized_name`,
    )
    .all() as { normalized_name: string }[];
  return rows.map((r) => r.normalized_name);
}

function getCategoryMap(db: Database.Database): Map<string, number> {
  const rows = db
    .prepare('SELECT id, name FROM product_categories')
    .all() as { id: number; name: string }[];
  return new Map(rows.map((r) => [r.name, r.id]));
}

async function classifyBatch(
  client: Anthropic,
  products: string[],
): Promise<Record<string, string>> {
  const productList = products.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Classify these Swedish grocery product names into exactly one category each.

Categories: ${CATEGORIES.join(', ')}

Products:
${productList}

Return ONLY a JSON object mapping each product name (exactly as given) to its category. No explanation, no markdown fences. Example: {"gul lök ica": "Vegetables", "smörcroissant": "Bread & Bakery"}`,
      },
    ],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON — handle possible markdown fences
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Failed to parse response:', text.slice(0, 200));
    return {};
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('Invalid JSON in response:', jsonMatch[0].slice(0, 200));
    return {};
  }
}

async function main() {
  // Load API key from secrets file if not in environment
  if (!process.env.ANTHROPIC_API_KEY) {
    try {
      const secretsPath = path.join(process.cwd(), 'groups', 'telegram_main', 'secrets.env');
      const secrets = fs.readFileSync(secretsPath, 'utf-8');
      const match = secrets.match(/ANTHROPIC_API_KEY=(.+)/);
      if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
    } catch {}
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not found in environment or secrets.env');
    process.exit(1);
  }

  const client = new Anthropic();
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  setupDb(db);

  const products = getUnclassifiedProducts(db);
  if (products.length === 0) {
    console.log('All products already classified.');
    db.close();
    return;
  }

  console.log(`${products.length} products to classify in ${Math.ceil(products.length / BATCH_SIZE)} batches.`);

  const categoryMap = getCategoryMap(db);
  const insertMapping = db.prepare(
    `INSERT OR REPLACE INTO product_category_map (normalized_name, category_id, confidence, source)
     VALUES (?, ?, ?, 'llm')`,
  );

  let classified = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(products.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} products)...`);

    try {
      const results = await classifyBatch(client, batch);

      const insertBatch = db.transaction(() => {
        for (const [product, category] of Object.entries(results)) {
          const catId = categoryMap.get(category);
          if (!catId) {
            // Try case-insensitive match
            const match = CATEGORIES.find(
              (c) => c.toLowerCase() === category.toLowerCase(),
            );
            const resolvedId = match ? categoryMap.get(match) : categoryMap.get('Other');
            if (resolvedId) {
              insertMapping.run(product, resolvedId, 0.8);
              classified++;
            } else {
              failed++;
            }
          } else {
            insertMapping.run(product, catId, 0.9);
            classified++;
          }
        }
      });
      insertBatch();

      // Check for products in batch that weren't in the response
      const returned = new Set(Object.keys(results).map((k) => k.toLowerCase()));
      for (const p of batch) {
        if (!returned.has(p.toLowerCase())) {
          failed++;
        }
      }
    } catch (err: any) {
      console.error(`Batch ${batchNum} failed:`, err?.message || err);
      failed += batch.length;
      if (err?.status === 401) {
        console.error('Authentication failed — check your ANTHROPIC_API_KEY.');
        break;
      }
    }
  }

  const totalInDb = (
    db.prepare('SELECT COUNT(*) as c FROM product_category_map').get() as {
      c: number;
    }
  ).c;

  console.log(`\nDone.`);
  console.log(`  Classified this run: ${classified}`);
  console.log(`  Failed/missing: ${failed}`);
  console.log(`  Total in DB: ${totalInDb}`);

  db.close();
}

main();
