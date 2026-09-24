# In-app updates

ResourceScope checks for new versions in **Settings → About** (and once a day
if "Check Automatically" is on). How it updates depends on whether the release
pipeline signs updater bundles:

| Setup | What users get |
|-------|----------------|
| No signing key (default) | "Download x.y.z" button that opens the GitHub release page. Uses the public GitHub Releases API; nothing to configure. |
| Signing key configured | "Install x.y.z & restart": the app downloads the signed bundle for its platform, verifies the signature, installs, and relaunches. |

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
