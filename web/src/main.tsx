import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { resumeSaved } from './store'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root nao encontrado')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
void resumeSaved()
