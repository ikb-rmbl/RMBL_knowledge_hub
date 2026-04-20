'use client'

import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const stored = localStorage.getItem('rmbl-theme')
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored)
      document.documentElement.setAttribute('data-theme', stored)
    }
  }, [])

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('rmbl-theme', next)
  }

  return (
    <button
      onClick={toggle}
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label="Toggle theme"
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        color: 'var(--color-header-text)',
        opacity: 0.7,
        fontSize: '18px',
        lineHeight: 1,
      }}
    >
      {theme === 'light' ? '☽' : '☀'}
    </button>
  )
}
