---
name: groceries
description: Query Vin's grocery purchase history — spending, products, frequency, categories, store breakdowns. Use when the user asks about groceries, food spending, shopping habits, or receipt data.
allowed-tools: Bash(sqlite3:*)
---

# Groceries Database

A SQLite database of Vin's grocery receipts from Kivra (Swedish digital mailbox).

**Database:** `/workspace/global/groceries.db`

**Query with:** `sqlite3 /workspace/global/groceries.db "<query>"`

## Schema

- `stores` (id, name, address, org_number) — 13 stores (ICA locations + pharmacies)
- `receipts` (id, key, store_id, purchase_date, total_amount, source_file) — ~568 receipts, 2022–2025
- `line_items` (id, receipt_id, name, normalized_name, price, quantity, unit, unit_price, item_type) — ~4200 items, 1250 unique products
- `discounts` (id, line_item_id, description, amount) — costModifiers from receipts
- `product_categories` (id, name) + `product_category_map` (normalized_name, category_id, confidence, source) — 1249 products classified via LLM

## Key columns

- `normalized_name` — lowercase, trimmed, leading `*` stripped. Use for grouping/matching.
- `quantity` / `unit` — parsed from "0,405 kg" or "2 st". Often null (flat price).
- `item_type` — `'product'` (groceries) or `'general_deposit'` (pant/bottle deposit returns).

**Categories:** Vegetables, Fruit, Dairy, Bread & Bakery, Meat & Fish, Beverages, Pantry & Dry Goods, Frozen, Snacks & Sweets, Condiments & Sauces, Household, Health & Pharmacy, Baby, Other.

## Useful queries

```sql
-- Most frequently purchased products
SELECT normalized_name, COUNT(DISTINCT receipt_id) as trips, COUNT(*) as times
FROM line_items WHERE item_type='product'
GROUP BY normalized_name ORDER BY trips DESC LIMIT 20;

-- Average days between purchases (for items bought 3+ times)
WITH p AS (
  SELECT normalized_name, r.purchase_date,
    LAG(r.purchase_date) OVER (PARTITION BY normalized_name ORDER BY r.purchase_date) prev
  FROM line_items li JOIN receipts r ON li.receipt_id = r.id WHERE li.item_type='product'
)
SELECT normalized_name, COUNT(*) n, ROUND(AVG(julianday(purchase_date)-julianday(prev)),1) avg_days
FROM p WHERE prev IS NOT NULL GROUP BY normalized_name HAVING n>=3 ORDER BY avg_days;

-- Monthly spend by store
SELECT s.name, strftime('%Y-%m', r.purchase_date) month, ROUND(SUM(r.total_amount),2) total
FROM receipts r JOIN stores s ON r.store_id=s.id GROUP BY s.name, month ORDER BY month DESC;

-- Spending by category
SELECT pc.name category, COUNT(*) items, ROUND(SUM(li.price),2) total_spent
FROM line_items li
JOIN product_category_map pcm ON li.normalized_name=pcm.normalized_name
JOIN product_categories pc ON pcm.category_id=pc.id
GROUP BY pc.name ORDER BY total_spent DESC;

-- Top products in a category
SELECT li.normalized_name, COUNT(DISTINCT li.receipt_id) trips, ROUND(SUM(li.price),2) spent
FROM line_items li
JOIN product_category_map pcm ON li.normalized_name=pcm.normalized_name
JOIN product_categories pc ON pcm.category_id=pc.id
WHERE pc.name='Vegetables'
GROUP BY li.normalized_name ORDER BY trips DESC LIMIT 10;
```
