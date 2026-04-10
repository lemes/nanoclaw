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

The session is saved at `/workspace/global/pickuplimes-session.json` (refresh token and API key persist).

To refresh the session token and fetch a recipe:

```python
import json, urllib.request, urllib.parse, time

session = json.load(open("/workspace/global/pickuplimes-session.json"))
REFRESH_TOKEN = session["stsTokenManager"]["refreshToken"]
API_KEY = session["apiKey"]

data = urllib.parse.urlencode({'grant_type': 'refresh_token', 'refresh_token': REFRESH_TOKEN}).encode()
req = urllib.request.Request(f"https://securetoken.googleapis.com/v1/token?key={API_KEY}", data=data)
with urllib.request.urlopen(req) as r:
    tokens = json.loads(r.read())
id_token = tokens['id_token']
```

Then inject the session into agent-browser and navigate to the recipe URL. The recipe page exposes ingredients and steps in the DOM — extract with `agent-browser eval`.
