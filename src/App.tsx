import { useState, useEffect, lazy, Suspense } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Dashboard from './components/Dashboard'
import CpuPanel from './components/panels/CpuPanel'
import MemoryPanel from './components/panels/MemoryPanel'
import GpuPanel from './components/panels/GpuPanel'
import DiskPanel from './components/panels/DiskPanel'
import NetworkPanel from './components/panels/NetworkPanel'
import ProcessesPanel from './components/panels/ProcessesPanel'
import SettingsPanel from './components/panels/SettingsPanel'
// Charts pull in recharts; load them only when the History tab opens.
const HistoryPanel = lazy(() => import('./components/panels/HistoryPanel'))
import { useMetricsStore } from './store/metricsStore'
import { useSettingsStore } from './store/settingsStore'
import { usePlatformStore } from './store/platformStore'
import type { MetricsSnapshot } from './types'

// StrictMode mounts effects twice in dev; only honour "Start in tray" once.
let startupHandled = false

export default function App() {
  const [activeNav, setActiveNav] = useState('overview')
  const ingest = useMetricsStore(s => s.ingestSnapshot)
  const refreshIntervalMs = useSettingsStore(s => s.refreshIntervalMs)
  const showMenubarStats = useSettingsStore(s => s.showMenubarStats)
  const menubarMode = useSettingsStore(s => s.menubarMode)
  const menubarRefreshIntervalMs = useSettingsStore(s => s.menubarRefreshIntervalMs)
  const loadPlatform = usePlatformStore(s => s.load)

  // One-time startup: initial snapshot, live subscription, start-in-tray.
  // Kept separate from the settings effects below so changing a setting
  // doesn't tear down the event listener or re-fetch a snapshot.
  useEffect(() => {
    invoke<MetricsSnapshot>('get_metrics')
      .then(ingest)
      .catch(err => console.warn('[ResourceScope] Initial metrics failed:', err))

    const unlisten = listen<MetricsSnapshot>('metrics_update', (event) => {
      ingest(event.payload)
    })

    loadPlatform().then(info => {
      if (info?.tray_available && useSettingsStore.getState().startInTray && !startupHandled) {
        invoke('hide_to_tray').catch(err => console.warn('[ResourceScope] Start in tray failed:', err))
      }
      startupHandled = true
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [ingest, loadPlatform])

  // Push persisted preferences to the backend (on startup and when changed).
  useEffect(() => {
    invoke('set_refresh_interval', { intervalMs: refreshIntervalMs }).catch(err =>
      console.warn('[ResourceScope] Refresh interval failed:', err),
    )
  }, [refreshIntervalMs])

  useEffect(() => {
    invoke('set_show_menubar_stats', { show: showMenubarStats }).catch(err =>
      console.warn('[ResourceScope] Menubar stats toggle failed:', err),
    )
  }, [showMenubarStats])

  useEffect(() => {
    invoke('set_menubar_mode', { mode: menubarMode }).catch(err =>
      console.warn('[ResourceScope] Menubar mode failed:', err),
    )
  }, [menubarMode])

  useEffect(() => {
    invoke('set_menubar_refresh_interval', { intervalMs: menubarRefreshIntervalMs }).catch(err =>
      console.warn('[ResourceScope] Menubar refresh interval failed:', err),
    )
  }, [menubarRefreshIntervalMs])

  const csvLogging = useSettingsStore(s => s.csvLogging)
  useEffect(() => {
    invoke('set_csv_logging', { enabled: csvLogging }).catch(err =>
      console.warn('[ResourceScope] CSV logging toggle failed:', err),
    )
  }, [csvLogging])

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 flex overflow-hidden">
          {activeNav === 'overview' && <Dashboard onNavigate={setActiveNav} />}
          {activeNav === 'gpu'      && <GpuPanel />}
          {activeNav === 'cpu'      && <CpuPanel />}
          {activeNav === 'memory'   && <MemoryPanel />}
          {activeNav === 'disk'     && <DiskPanel />}
          {activeNav === 'network'  && <NetworkPanel />}
          {activeNav === 'processes' && <ProcessesPanel />}
          {activeNav === 'history'  && <Suspense fallback={null}><HistoryPanel /></Suspense>}
          {activeNav === 'settings' && <SettingsPanel />}
        </div>
      </div>
    </div>
  )
}
