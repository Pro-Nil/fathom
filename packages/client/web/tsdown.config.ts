import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@fathom/client-web',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
