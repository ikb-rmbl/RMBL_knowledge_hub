'use client'

import { useEffect, useRef } from 'react'

interface PlacePoint {
  id: number
  name: string
  placeType: string | null
  lat: number
  lon: number
  elevationM: number | null
  mentionCount: number
}

interface Props {
  places: PlacePoint[]
  center: [number, number]
  zoom: number
}

const TYPE_COLORS: Record<string, string> = {
  study_site: '#c62828',
  peak: '#6d4c41',
  valley: '#2e7d32',
  watershed: '#1565c0',
  stream: '#0288d1',
  lake: '#0097a7',
  meadow: '#558b2f',
  town: '#e65100',
  trail: '#7b1fa2',
  named_point: '#795548',
}

export default function PlacesMap({ places, center, zoom }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false

    ;(async () => {
      const L = await import('leaflet')
      await import('leaflet/dist/leaflet.css')

      if (cancelled || !containerRef.current) return

      const map = L.map(containerRef.current, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      })
      mapRef.current = map

      // Greyscale basemap (CartoDB Positron)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 16,
      }).addTo(map)

      // Size scale: log of mention count, clamped
      const maxMentions = Math.max(1, ...places.map((p) => p.mentionCount))
      const minRadius = 5
      const maxRadius = 25

      for (const p of places) {
        const ratio = Math.log(p.mentionCount + 1) / Math.log(maxMentions + 1)
        const radius = minRadius + ratio * (maxRadius - minRadius)
        const color = TYPE_COLORS[p.placeType || ''] || '#999'

        const circle = L.circleMarker([p.lat, p.lon], {
          radius,
          fillColor: color,
          fillOpacity: 0.7,
          color: '#fff',
          weight: 1.5,
          opacity: 0.9,
        }).addTo(map)

        const tooltip = [
          `<strong>${p.name}</strong>`,
          p.placeType ? `<span style="color:#666">${p.placeType.replace(/_/g, ' ')}</span>` : '',
          p.elevationM ? `${p.elevationM}m` : '',
          `${p.mentionCount} mention${p.mentionCount !== 1 ? 's' : ''}`,
        ].filter(Boolean).join(' · ')

        circle.bindTooltip(tooltip, { direction: 'top', offset: [0, -radius] })
        circle.on('click', () => {
          window.location.href = `/places/${p.id}`
        })
        circle.getElement()?.setAttribute('style', (circle.getElement()?.getAttribute('style') || '') + '; cursor: pointer;')
      }

      // Don't auto-fit — respect the initial center/zoom so the view
      // stays focused on the RMBL area. Users can zoom out manually.
    })()

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [places, center, zoom])

  return (
    <div>
      <div ref={containerRef} style={{
        width: '100%', height: '70vh', maxHeight: '700px',
        borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
      }} />
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px', fontSize: '11px' }}>
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
            {type.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </div>
  )
}
