'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Click-to-activate scroll-zoom gating for embedded Sigma graphs.
 *
 * Default Sigma behavior is to intercept wheel events on its canvas and
 * zoom the camera. That fights with the user's expectation that scrolling
 * the page scrolls the page — when a graph sits mid-article, a user
 * scrolling past it instead zooms wildly into a node.
 *
 * Fix: while the graph is inactive (initial state, or after a click
 * outside), intercept wheel events at the *capture* phase on the wrapper
 * element and stop their propagation before Sigma's canvas listener can
 * fire. We do NOT call preventDefault, so the browser's native page
 * scroll still happens — that's the desired behavior.
 *
 * Click on the wrapper sets `active = true`; click anywhere outside sets
 * it back to `false`. Other interactions (node hover, node click, drag
 * pan) are unaffected — only the wheel event is gated.
 *
 * Usage:
 *
 *   const containerRef = useRef<HTMLDivElement>(null)
 *   const { active, activate } = useClickToActivateZoom(containerRef)
 *   // ...
 *   <div ref={containerRef} onClick={activate} ... />
 *   {!active && <SmallHint />}
 */
export function useClickToActivateZoom(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false)

  // Wheel-event gating. Capture phase so we beat Sigma's listener on
  // any descendant element (the canvas it mounts).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!active) e.stopPropagation()
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true } as AddEventListenerOptions)
  }, [ref, active])

  // Click outside deactivates so the next page-scroll gesture stops
  // mid-graph as the user expects.
  useEffect(() => {
    if (!active) return
    function onDocDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setActive(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [ref, active])

  return { active, activate: () => setActive(true) }
}
