/**
 * updateStore.ts — "Is there a newer ResourceScope?"
 *
 * Two paths:
 *  - In-app updates via tauri-plugin-updater when a signing key is set up
 *    (platform info reports `updater_configured`): download, install, relaunch.
 *  - Otherwise, ask the GitHub Releases API for the latest published tag and
 *    offer a link to the release page.
 */

import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { usePlatformStore } from './platformStore'
import { compareVersions } from '../lib/version'

const RELEASES_API = 'https://api.github.com/repos/Cosm00/resourcescope/releases/latest'
const LAST_CHECK_KEY = 'resourcescope-last-update-check'
const AUTO_CHECK_EVERY_MS = 24 * 3600 * 1000

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'

interface UpdateState {
  status: Status
  current: string | null
  latest: string | null
  notes: string | null
  releaseUrl: string | null
  canInstall: boolean
  error: string | null
  check: () => Promise<void>
  maybeAutoCheck: () => void
  install: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  current: null,
  latest: null,
  notes: null,
  releaseUrl: null,
  canInstall: false,
  error: null,

  async check() {
    if (get().status === 'checking' || get().status === 'installing') return
    set({ status: 'checking', error: null })
    try {
      const current = await getVersion()
      const info = await usePlatformStore.getState().load()
      try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())) } catch { /* ignore */ }

      if (info?.updater_configured) {
        try {
          const { check } = await import('@tauri-apps/plugin-updater')
          const update = await check()
          if (update) {
            set({ status: 'available', current, latest: update.version, notes: update.body ?? null, canInstall: true, releaseUrl: null })
          } else {
            set({ status: 'up-to-date', current, latest: current, notes: null, releaseUrl: null, canInstall: false })
          }
          return
        } catch (err) {
          // e.g. the latest release predates signed updates (no latest.json):
          // fall through to the plain GitHub check so users still hear about it.
          console.warn('[ResourceScope] Updater check failed, falling back to GitHub:', err)
        }
      }

      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      if (res.status === 404) {
        set({ status: 'up-to-date', current, latest: current, notes: null, releaseUrl: null, canInstall: false })
        return
      }
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
      const release = await res.json() as { tag_name: string; html_url: string; body?: string }
      const newer = compareVersions(release.tag_name, current) > 0
      set({
        status: newer ? 'available' : 'up-to-date',
        current,
        latest: release.tag_name.replace(/^v/i, ''),
        notes: release.body ?? null,
        releaseUrl: release.html_url,
        canInstall: false,
      })
    } catch (err) {
      set({ status: 'error', error: String(err) })
    }
  },

  maybeAutoCheck() {
    let last = 0
    try { last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0 } catch { /* ignore */ }
    if (Date.now() - last >= AUTO_CHECK_EVERY_MS) get().check()
  },

  async install() {
    set({ status: 'installing', error: null })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      const update = await check()
      if (!update) {
        set({ status: 'up-to-date' })
        return
      }
      await update.downloadAndInstall()
      await relaunch()
    } catch (err) {
      set({ status: 'error', error: String(err) })
    }
  },
}))
