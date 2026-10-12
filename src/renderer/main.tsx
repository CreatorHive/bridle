import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import { Root } from './app/App'

// CSS adjusts the chrome per platform: [data-platform="win"] leaves room for the window buttons on the right.
document.documentElement.dataset.platform = /Win/.test(navigator.platform) ? 'win' : /Mac/.test(navigator.platform) ? 'mac' : 'linux'
// Onboarding's light field is drawn for light mode only: it keeps the light tokens (tokens.css).
if (location.hash === '#onboarding') document.documentElement.dataset.window = 'onboarding'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root hash={location.hash} />
  </StrictMode>
)
