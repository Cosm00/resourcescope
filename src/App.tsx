import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import Dashboard from './components/Dashboard'
import { useMetricsStore } from './store/metricsStore'
import type { MetricsSnapshot } from './types'

export default function App() {
  const [activeNav, setActiveNav] = useState('overview')
  const ingest = useMetricsStore(s => s.ingestSnapshot)

  useEffect(() => {
    // Initial load — get one snapshot immediately
    invoke<MetricsSnapshot>('get_metrics')
      .then(ingest)
      .catch(err => console.warn('[ResourceScope] Initial metrics failed:', err))

    // Subscribe to streaming updates from Rust backend
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
          {(activeNav === 'overview' || activeNav === 'gpu') && <Dashboard />}
          {activeNav !== 'overview' && activeNav !== 'gpu' && (
            <div className="flex-1 flex items-center justify-center flex-col gap-3">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                🚧
              </div>
              <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>
                {activeNav} panel — coming soon
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Switch to Overview to see the live dashboard
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
