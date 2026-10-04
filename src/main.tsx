import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './App.css'
import App from './App'

const container = document.getElementById('root')

if (!container) {
    throw new Error('Root element #root is missing from index.html')
}

async function start(root: HTMLElement) {
    if (import.meta.env.DEV) {
        const { scan } = await import('react-scan')
        scan({ enabled: true })
    }

    createRoot(root).render(
        <StrictMode>
            <App />
        </StrictMode>
    )
}

void start(container)
