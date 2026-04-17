'use client'

import dynamic from 'next/dynamic'

const PlacesMap = dynamic(() => import('./PlacesMap'), { ssr: false })

interface PlacePoint {
  id: number
  name: string
  placeType: string | null
  lat: number
  lon: number
  elevationM: number | null
  mentionCount: number
}

export default function LazyMap({ places, center, zoom }: { places: PlacePoint[]; center: [number, number]; zoom: number }) {
  return <PlacesMap places={places} center={center} zoom={zoom} />
}
