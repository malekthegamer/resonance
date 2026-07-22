import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniPlayer from './MiniPlayer'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

// Both windows share one bundle; the route decides which shell mounts. The
// mini-player deliberately mounts a different tree so it never constructs an
// AudioContext of its own.
const isMini = new URLSearchParams(window.location.search).get('window') === 'mini'

createRoot(container).render(
  <StrictMode>{isMini ? <MiniPlayer /> : <App />}</StrictMode>
)
