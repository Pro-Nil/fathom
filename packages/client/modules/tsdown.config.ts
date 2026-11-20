import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@fathom/client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
