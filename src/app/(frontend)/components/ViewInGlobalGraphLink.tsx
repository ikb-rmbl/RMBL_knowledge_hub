import Link from 'next/link'
import { inGlobalGraph } from '../../../services/global-graph-index'

/**
 * Renders nothing if the node isn't a member of the unified global graph
 * (degree-pruned away). Otherwise renders a small "View in full graph" link.
 */
export default function ViewInGlobalGraphLink({ globalNodeId }: { globalNodeId: string | null }) {
  if (!globalNodeId || !inGlobalGraph(globalNodeId)) return null
  return (
    <Link
      href={`/explore/unified?focus=${encodeURIComponent(globalNodeId)}`}
      style={{
        fontSize: '13px',
        color: 'var(--color-accent)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      View in full graph &rarr;
    </Link>
  )
}
