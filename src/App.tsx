import { useEffect, useState } from 'react'
import './App.css'
import IntroPage from './pages/IntroPage'
import MapPage from './pages/MapPage'
import RankingPage from './pages/RankingPage'

type ViewMode = 'intro' | 'map' | 'ranking'

const MAP_HASH = '#/map'
const RANKING_HASH = '#/ranking'

function resolveViewModeFromHash(): ViewMode {
  if (typeof window === 'undefined') {
    return 'intro'
  }
  if (window.location.hash === MAP_HASH) {
    return 'map'
  }
  if (window.location.hash === RANKING_HASH) {
    return 'ranking'
  }
  return 'intro'
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>(() => resolveViewModeFromHash())

  useEffect(() => {
    const onHashChange = () => {
      setViewMode(resolveViewModeFromHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (viewMode === 'map') {
    return <MapPage />
  }

  if (viewMode === 'ranking') {
    return <RankingPage />
  }

  return <IntroPage />
}

export default App
