/**
 * platformStore.ts — What the host OS / desktop supports, fetched once from
 * the backend so the UI can hide controls that can't work (e.g. hide-to-tray
 * on a Linux desktop without a system tray).
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { PlatformInfo } from '../types'

interface PlatformState {
  info: PlatformInfo | null
  load: () => Promise<PlatformInfo | null>
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  info: null,
  async load() {
    if (get().info) return get().info
    try {
      const info = await invoke<PlatformInfo>('get_platform_info')
      set({ info })
      return info
    } catch (err) {
      console.warn('[ResourceScope] Platform info unavailable:', err)
      return null
    }
  },
}))

/** Process-action wording that matches each OS's own task manager. Windows
 *  has no graceful-terminate signal, so only "End task" is offered there. */
export function processActionLabels(os: string | undefined) {
  if (os === 'windows') {
    return { graceful: null, gracefulBusy: null, force: 'End Task', forceBusy: 'Ending…', help: 'End Task terminates the selected process immediately.' }
  }
  if (os === 'linux') {
    return { graceful: 'Terminate', gracefulBusy: 'Terminating…', force: 'Kill', forceBusy: 'Killing…', help: 'Terminate sends SIGTERM so the process can exit cleanly. Kill sends SIGKILL when it is frozen, hung, or ignoring SIGTERM.' }
  }
  return { graceful: 'Quit App', gracefulBusy: 'Quitting…', force: 'Force Quit', forceBusy: 'Force quitting…', help: 'Quit App asks the selected process to exit normally. Force Quit kills it immediately when it is frozen, hung, or ignoring normal shutdown.' }
}
