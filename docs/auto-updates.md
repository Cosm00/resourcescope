# In-app updates

ResourceScope checks for new versions in **Settings → About** (and once a day
if "Check Automatically" is on). How it updates depends on whether the release
pipeline signs updater bundles:

| Setup | What users get |
|-------|----------------|
| No signing key (default) | "Download x.y.z" button that opens the GitHub release page. Uses the public GitHub Releases API; nothing to configure. |
| Signing key configured | **Automatic updates.** The app checks shortly after launch and every 6 hours (even while hidden in the tray), downloads the new version in the background, verifies its signature, and shows a notification plus a **Restart to update** button. The update installs on that restart. Users can turn off automatic checking or downloading in Settings → About. |

## Enabling one-click updates

Tauri's updater only installs bundles signed with your private key. Do this once:

1. **Generate a key pair** (keep the private key out of the repo):

   ```bash
   npm run tauri signer generate -- -w ~/.tauri/resourcescope.key
   ```

   This prints the **public key** and writes the private key to
   `~/.tauri/resourcescope.key` (you'll be asked for an optional password).

2. **Commit the public key** into `src-tauri/tauri.conf.json`:

   ```json
   "plugins": {
     "updater": {
       "pubkey": "<paste the public key here>",
       "endpoints": ["https://github.com/Cosm00/resourcescope/releases/latest/download/latest.json"]
     }
   }
   ```

   The app registers the updater plugin only when `pubkey` is non-empty, so
   builds without it keep using the download-link fallback.

3. **Add repository secrets** (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `~/.tauri/resourcescope.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password (or leave empty if none)

4. **Release as usual** (push a `v*` tag). When the secret is present the
   release workflow adds `createUpdaterArtifacts`, so `tauri-action` uploads
   signed `.tar.gz` / `.zip` / `.AppImage` update bundles and a `latest.json`
   manifest to the draft release.

5. **Publish the draft release.** `/releases/latest/` ignores drafts, so
   installed apps only see the update once the release is published.

> Losing the private key means existing installs can no longer verify
> updates. Back it up somewhere safe (e.g. a password manager).

## Notes

- Only builds that ship with the public key can update themselves. Installs of
  earlier versions see the "Download x.y.z" link once, then update
  automatically from the next version onward.
- Linux: AppImage, .deb and .rpm installs update in place. macOS updates need
  the release to be notarized (see the Apple secrets in the release workflow).
- The app never restarts on its own; the update applies when the user clicks
  **Restart to update** (or next time they launch it).
