#!/usr/bin/env node

import { Context } from '@fathom/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@fathom/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@fathom/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
