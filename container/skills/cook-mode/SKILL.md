---
name: cook-mode
description: Add or edit recipes in the Cook Mode web app. Use when the user wants to add a new recipe, modify an existing one, or asks about the recipe system.
allowed-tools: Bash(agent-browser:*), Read, Write
---

# Cook Mode — Recipe System

A cooking assistant web app. Recipes live at:
- **Engine**: `/workspace/global/public/cook-mode.html` (generic, loads any recipe)
- **Index**: `/workspace/global/public/recipes.html` (lists all recipes)
- **Recipe files**: `/workspace/global/public/recipes/*.json`
- **Base URL**: `https://viniciuss-macbook-pro.tailc7cd9d.ts.net:8443/global/`

To add a new recipe:
1. Create `/workspace/global/public/recipes/<id>.json` following the schema below
2. Add the id string to the `RECIPES` array in `recipes.html`

## Recipe JSON schema

```json
{
  "id": "recipe-id",
  "title": "Recipe Title",
  "emoji": "\ud83c\udf5d",
  "source": "Pick Up Limes",
  "sourceUrl": "https://...",
  "totalTime": "30 min",
  "tags": ["Vegan", "Quick", "Main"],
  "baseServings": 2,
  "ingredients": [
    { "id": "pasta", "name": "Linguine", "amount": 250, "unit": "g" },
    { "id": "butter", "name": "Vegan butter", "amount": 2, "unit": "tbsp" },
    { "id": "salt", "name": "Salt", "amount": 1, "unit": "pinch" },
    { "id": "basil", "name": "Fresh basil", "amount": 0, "unit": "garnish", "optional": true }
  ],
  "steps": [
    {
      "emoji": "\ud83e\udED5",
      "title": "Step title",
      "body": "Step instructions. Use \\n\\n for paragraphs.",
      "approxTime": "~8 min",
      "ingredients": ["pasta"],
      "timer": { "name": "Pasta", "mins": 8 },
      "last": false
    }
  ]
}
```

Supported units: `g`, `kg`, `ml`, `tbsp`, `tsp`, `cup`, `piece`, `pinch`, `garnish`, `taste`

Set `"last": true` on the final step.

## Fetching a recipe from Pick Up Limes

A saved browser session is at `/workspace/global/pickuplimes-browser-state.json`. Load it to access premium recipes.

```bash
agent-browser state load /workspace/global/pickuplimes-browser-state.json
agent-browser open <recipe-url>
agent-browser wait --load networkidle
agent-browser wait 3000
```

Then extract ingredients and steps:

```bash
agent-browser eval "
const ingredients = [...document.querySelectorAll('.ingredient-container')].map(e => e.innerText?.trim()).filter(Boolean);
const steps = [...document.querySelectorAll('.direction')].map(e => e.innerText?.trim()).filter(Boolean);
const title = document.querySelector('h1')?.innerText?.trim();
const time = document.querySelector('[class*=time]')?.innerText?.trim();
JSON.stringify({title, time, ingredients, steps});
"
```

If the recipe is still gated after loading state (session expired):
1. Open the recipe URL in agent-browser
2. Click "Try 7 days free" to open the auth modal
3. Click "Continue with Email"
4. A JS prompt will appear — ask Vin for the Pick Up Limes email and enter it
5. Vin will receive a magic link — ask him to paste it
6. Navigate to the magic link URL
7. A second JS prompt asks to confirm email — enter the same address again
8. Save new state: `agent-browser state save /workspace/global/pickuplimes-browser-state.json`

After successfully fetching a recipe, always re-save the browser state to keep the session fresh.
