/**
 * Shared embedding and clustering utilities.
 *
 * Consolidates identical embedTexts(), cosineSimilarity(), and
 * clusterCandidates() implementations from cluster-protocols.ts
 * and cluster-concepts.ts.
 */

import { VOYAGE_API_KEY, VOYAGE_MODEL, EMBEDDING_DIMENSIONS } from './config.js'
import { sleep } from './concurrency.js'

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings'
const EMBED_BATCH_SIZE = 128

/**
 * Compute embeddings for a list of texts via Voyage AI.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const allEmbeddings: number[][] = []
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE)
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        input: batch,
        model: VOYAGE_MODEL,
        input_type: 'document',
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Voyage AI error ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    allEmbeddings.push(...data.data.map((d: any) => d.embedding))
    if (i + EMBED_BATCH_SIZE < texts.length) await sleep(200)
  }
  return allEmbeddings
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * A cluster with a running-average centroid and its members.
 */
export interface Cluster<T> {
  centroid: number[]
  members: T[]
}

/**
 * Greedy centroid clustering: for each candidate, if cosine similarity
 * to the nearest cluster centroid >= threshold → merge, else → new cluster.
 */
export function clusterCandidates<T extends { embedding: number[] }>(
  candidates: T[],
  threshold: number,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = []

  for (const candidate of candidates) {
    let bestCluster: Cluster<T> | null = null
    let bestSim = -1

    for (const cluster of clusters) {
      const sim = cosineSimilarity(candidate.embedding, cluster.centroid)
      if (sim > bestSim) {
        bestSim = sim
        bestCluster = cluster
      }
    }

    if (bestCluster && bestSim >= threshold) {
      bestCluster.members.push(candidate)
      // Update centroid as running average
      for (let i = 0; i < bestCluster.centroid.length; i++) {
        bestCluster.centroid[i] =
          (bestCluster.centroid[i] * (bestCluster.members.length - 1) + candidate.embedding[i]) /
          bestCluster.members.length
      }
    } else {
      clusters.push({
        centroid: [...candidate.embedding],
        members: [candidate],
      })
    }
  }

  return clusters
}
