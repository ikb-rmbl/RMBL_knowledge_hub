'use client'

import { useEffect } from 'react'

const ART = String.raw`
              /\
             /  \
            /    \
           /  /\  \
          /  /  \  \         RMBL Knowledge Commons
         /  /    \  \        Gothic, Colorado · since 1928
        /  /      \  \
       /__/________\__\      science.OUTSIDE.
`

export default function ConsoleGreeting() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as { __rmblGreeted?: boolean }
    if (w.__rmblGreeted) return
    w.__rmblGreeted = true
    /* eslint-disable no-console */
    console.log(`%c${ART}`, 'color:#7a6a4a;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.1')
    console.log(
      '%cHi, fellow field scientist.',
      'font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:15px;color:#F05028',
    )
    console.log(
      '%cSource: https://github.com/ikb-rmbl/RMBL_knowledge_hub  ·  ikb@rmbl.org',
      'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#7a6a4a;font-size:11px',
    )
    /* eslint-enable no-console */
  }, [])
  return null
}
