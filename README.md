# Idle Clans WebApp

## Update data

1. Edit `WebApp/tools/config.json` and set your `clanName`.
2. Run the updater:
   ```
   node WebApp/tools/update-data.mjs
   ```
   This fetches API data (15 calls/minute), writes JSON into `WebApp/data/`,
   and runs `git add/commit/push` for the data folder.

## Run locally

Serve `WebApp/` with any local static server so the JSON loads correctly.
Example:
```
python -m http.server --directory WebApp 8000
```

Then visit `http://localhost:8000`.
