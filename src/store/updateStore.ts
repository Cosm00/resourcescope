/**
 * updateStore.ts — "Is there a newer ResourceScope?"
 *
 * Two paths:
 *  - In-app updates (a signing key is configured; platform info reports
 *    `updater_configured`): the Rust backend checks every few hours, downloads
 *    in the background and reports progress through `update_status` events;
 *    this store mirrors that and asks the backend to install + restart.
 *  - Otherwise, ask the GitHub Releases API for the latest published tag and
 *    offer a link to the release page.
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { usePlatformStore } from './platformStore'
import { compareVersions } from '../lib/version'

const RELEASES_API = 'https://api.github.com/repos/Cosm00/resourcescope/releases/latest'
const LAST_CHECK_KEY = 'resourcescope-last-update-check'
const AUTO_CHECK_EVERY_MS = 24 * 3600 * 1000

export type UpdatePhase =
  | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

/** Mirrors `updates::UpdateStatus` in the backend. */
interface BackendStatus {
  phase: UpdatePhase
  current_version: string
  version: string | null
  notes: string | null
  progress: number | null
  error: string | null
}

interface UpdateState {
  status: UpdatePhase
  current: string | null
  latest: string | null
  notes: string | null
  progress: number | null
  releaseUrl: string | null
  /** True when updates install in-app (vs. a link to the release page). */
  canInstall: boolean
  error: string | null
  init: () => Promise<void>
  check: () => Promise<void>
  maybeAutoCheck: () => void
  install: () => Promise<void>
}

let initialized = false

export const useUpdateStore = create<UpdateState>((set, get) => {
  const applyBackend = (s: BackendStatus) =>
    set({
      status: s.phase,
      current: s.current_version,
      latest: s.version ?? (s.phase === 'up-to-date' ? s.current_version : get().latest),
      notes: s.notes,
      progress: s.progress,
      error: s.error,
      releaseUrl: null,
      canInstall: true,
    })

  const checkGitHub = async () => {
    const current = await getVersion()
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
      notes: newer ? release.body ?? null : null,
      releaseUrl: newer ? release.html_url : null,
      canInstall: false,
    })
  }

  return {
    status: 'idle',
    current: null,
    latest: null,
    notes: null,
    progress: null,
    releaseUrl: null,
    canInstall: false,
    error: null,

    async init() {
      if (initialized) return
      initialized = true
      const info = await usePlatformStore.getState().load()
      set({ current: await getVersion().catch(() => null) })
      if (!info?.updater_configured) return
      // The backend owns checking/downloading; follow its progress.
      await listen<BackendStatus>('update_status', e => applyBackend(e.payload))
      applyBackend(await invoke<BackendStatus>('update_status'))
    },

    async check() {
      if (['checking', 'downloading', 'installing'].includes(get().status)) return
      set({ status: 'checking', error: null })
      try {
        try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())) } catch { /* ignore */ }
        const info = await usePlatformStore.getState().load()
        if (info?.updater_configured) {
          try {
            applyBackend(await invoke<BackendStatus>('update_check'))
            if (get().status !== 'error') return
          } catch (err) {
            console.warn('[ResourceScope] In-app update check failed:', err)
          }
          // e.g. the latest release predates signed updates (no latest.json):
          // fall back to the plain GitHub check so users still hear about it.
        }
        await checkGitHub()
      } catch (err) {
        set({ status: 'error', error: String(err) })
      }
    },

    /** Daily check for builds without in-app updates (the backend schedules its own). */
    maybeAutoCheck() {
      if (usePlatformStore.getState().info?.updater_configured) return
      let last = 0
      try { last = Number(localStorage.getItem(LAST_CHECK_KEY)) || 0 } catch { /* ignore */ }
      if (Date.now() - last >= AUTO_CHECK_EVERY_MS) get().check()
    },

    async install() {
      set({ status: 'installing', error: null })
      try {
        // Installs the (already downloaded) update and relaunches the app.
        await invoke('update_install')
      } catch (err) {
        set({ status: 'error', error: String(err) })
      }
    },
  }
})
