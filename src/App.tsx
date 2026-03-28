import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Dashboard from './components/Dashboard'
import CpuPanel from './components/panels/CpuPanel'
import MemoryPanel from './components/panels/MemoryPanel'
import DiskPanel from './components/panels/DiskPanel'
import NetworkPanel from './components/panels/NetworkPanel'
import ProcessesPanel from './components/panels/ProcessesPanel'
import SettingsPanel from './components/panels/SettingsPanel'
import { useMetricsStore } from './store/metricsStore'
import { useSettingsStore } from './store/settingsStore'
import type { MetricsSnapshot } from './types'

export default function App() {
  const [activeNav, setActiveNav] = useState('overview')
  const ingest = useMetricsStore(s => s.ingestSnapshot)
  const refreshIntervalMs = useSettingsStore(s => s.refreshIntervalMs)
  const setRefreshInterval = useSettingsStore(s => s.setRefreshInterval)

  useEffect(() => {
    invoke<MetricsSnapshot>('get_metrics')
      .then(ingest)
      .catch(err => console.warn('[ResourceScope] Initial metrics failed:', err))

    // Apply persisted refresh interval to backend on startup
    if (refreshIntervalMs !== 1500) {
      setRefreshInterval(refreshIntervalMs)
    }

    const unlisten = listen<MetricsSnapshot>('metrics_update', (event) => {
      ingest(event.payload)
    })

    return () => {
      unlisten.then(fn => fn())
    }
  }, [ingest])

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        <div className="flex-1 flex overflow-hidden">
          {activeNav === 'overview' && <Dashboard />}
          {activeNav === 'gpu'      && <Dashboard />}
          {activeNav === 'cpu'      && <CpuPanel />}
          {activeNav === 'memory'   && <MemoryPanel />}
          {activeNav === 'disk'     && <DiskPanel />}
          {activeNav === 'network'  && <NetworkPanel />}
          {activeNav === 'processes' && <ProcessesPanel />}
          {activeNav === 'settings' && <SettingsPanel />}
        </div>
      </div>
    </div>
  )
}
