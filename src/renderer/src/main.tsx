import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './state/store'
import { App } from './App'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container missing')
}

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
