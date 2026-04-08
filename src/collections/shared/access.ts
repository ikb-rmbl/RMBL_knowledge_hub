import type { Access } from 'payload'

/** Allow only authenticated users to write */
export const isAuthenticated: Access = ({ req }) => Boolean(req.user)

/** Public read, authenticated write */
export const publicReadAuthWrite = {
  read: () => true as const,
  create: isAuthenticated,
  update: isAuthenticated,
  delete: isAuthenticated,
}
