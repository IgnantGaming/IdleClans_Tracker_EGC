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

## Raspberry Pi (Ubuntu 24 LTS)

These steps set up automatic data updates (with git push) and local hosting.

### Prereqs

- Install packages:
  ```
  sudo apt update
  sudo apt install -y git nodejs npm python3
  ```
- Ensure Node supports `fetch` (Node 18+). Ubuntu 24 ships Node 20.
- Set git identity:
  ```
  git config --global user.name "Your Name"
  git config --global user.email "you@example.com"
  ```
- Set up GitHub SSH keys on the Pi (so `git push` works):
  ```
  ssh-keygen -t ed25519 -C "pi-webapp"
  cat ~/.ssh/id_ed25519.pub
  ```
  Add the key to GitHub, then test with:
  ```
  ssh -T git@github.com
  ```

### Clone + config

```
git clone git@github.com:YOUR_ORG/EndGameCrusade.git
cd EndGameCrusade/WebApp
```

Edit `WebApp/tools/config.json` and set your `clanName`.

### Run updates on demand

```
chmod +x WebApp/tools/run-update.sh
WebApp/tools/run-update.sh
```

### Scheduled updates (systemd timer)

1. Copy and edit the service files (replace `pi` and paths if needed):
   ```
   sudo cp WebApp/tools/webapp-update.service /etc/systemd/system/
   sudo cp WebApp/tools/webapp-update.timer /etc/systemd/system/
   sudo nano /etc/systemd/system/webapp-update.service
   ```
2. Enable the timer:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now webapp-update.timer
   ```
3. Check status/logs:
   ```
   systemctl status webapp-update.timer
   journalctl -u webapp-update.service -n 50 --no-pager
   ```

### Local hosting (systemd service)

1. Copy and edit the service file (replace `pi` and paths if needed):
   ```
   sudo cp WebApp/tools/webapp-serve.service /etc/systemd/system/
   sudo nano /etc/systemd/system/webapp-serve.service
   ```
2. Enable the service:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now webapp-serve.service
   ```
3. Visit from your LAN:
   ```
   http://PI_IP:8000
   ```
4. If UFW is enabled:
   ```
   sudo ufw allow 8000/tcp
   ```
