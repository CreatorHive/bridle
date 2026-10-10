import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import { Root } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root hash={location.hash} />
  </StrictMode>
)
