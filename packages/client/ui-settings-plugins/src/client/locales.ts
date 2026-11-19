/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'invalidNumberList'
  | 'compactionTitle' | 'compactionDescription' | 'compactionThreshold' | 'compactionThresholdHint'
  | 'compactionRetain' | 'compactionRetainHint' | 'compactionMaxTokens' | 'compactionMaxTokensHint'
  | 'spillTitle' | 'spillDescription' | 'spillMaxInlineBytes' | 'spillMaxInlineBytesHint'
  | 'prunerTitle' | 'prunerDescription' | 'prunerThreshold' | 'prunerThresholdHint'
  | 'prunerHead' | 'prunerHeadHint' | 'prunerTail' | 'prunerTailHint'
  | 'loopGuardTitle' | 'loopGuardDescription' | 'loopGuardRepeat' | 'loopGuardRepeatHint'
  | 'loopGuardFailure' | 'loopGuardFailureHint'
  | 'sessionFoldersTitle' | 'sessionFoldersDescription' | 'sessionFoldersEnabled' | 'sessionFoldersEnabledHint'
  | 'sessionFoldersFolder' | 'sessionFoldersFolderHint'
  | 'personaTitle' | 'personaDescription' | 'personaText' | 'personaTextHint'
  | 'webSearchTitle' | 'webSearchDescription' | 'webSearchProvider' | 'webSearchProviderHint'
  | 'webSearchFallback' | 'webSearchFallbackHint'

/** English copy. */
export const en = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  invalidNumberList: 'Enter whole numbers separated by commas, "off", or leave blank to use the default.',
  compactionTitle: 'Context compaction',
  compactionDescription: 'When the conversation is summarized to free up the context window.',
  compactionThreshold: 'Compact at (fraction of window)',
  compactionThresholdHint: 'For example 0.5 compacts when the context is half full. Lower saves tokens; higher keeps more exact detail.',
  compactionRetain: 'Keep verbatim (fraction of window)',
  compactionRetainHint: 'How much of the most recent conversation survives compaction word for word, e.g. 0.05.',
  compactionMaxTokens: 'Summary length (tokens)',
  compactionMaxTokensHint: 'Output-token budget for the summary that replaces older history.',
  spillTitle: 'Large tool output',
  spillDescription: 'When a tool result is saved to a file instead of being sent to the model.',
  spillMaxInlineBytes: 'Inline limit (bytes)',
  spillMaxInlineBytesHint: 'Results larger than this become a short preview plus a file path the agent can read or grep.',
  prunerTitle: 'Old tool results',
  prunerDescription: 'How older tool results are trimmed before full compaction runs.',
  prunerThreshold: 'Trim results longer than (characters)',
  prunerThresholdHint: 'Older results above this length are cut down to their head and tail.',
  prunerHead: 'Keep from the start (characters)',
  prunerHeadHint: 'Head + tail must fit under the trim length.',
  prunerTail: 'Keep from the end (characters)',
  prunerTailHint: 'Head + tail must fit under the trim length.',
  loopGuardTitle: 'Loop guards',
  loopGuardDescription: 'Reminders sent when the agent keeps repeating itself or failing.',
  loopGuardRepeat: 'Identical-call reminders at',
  loopGuardRepeatHint: 'After this many identical calls in a row, e.g. 3, 5, 8. Each number must be 2 or more.',
  loopGuardFailure: 'Failure-loop reminders at',
  loopGuardFailureHint: 'After this many failed calls in a row, e.g. 4, 7. Type "off" to disable.',
  sessionFoldersTitle: 'Session folders',
  sessionFoldersDescription: 'Give each session its own folder inside the workspace.',
  sessionFoldersEnabled: 'Use a folder per session',
  sessionFoldersEnabledHint: 'New sessions get a folder named after their title; the shell and file tools start there. Sessions that already have a folder keep it.',
  sessionFoldersFolder: 'Parent folder',
  sessionFoldersFolderHint: 'Relative to the workspace, e.g. sessions → <workspace>/sessions/<title>/.',
  personaTitle: 'Persona',
  personaDescription: 'The agent\'s system prompt for this preset.',
  personaText: 'Persona text',
  personaTextHint: 'Takes effect on the next request. {{model}} and {{cwd}} are filled in automatically. Reset restores the built-in text.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'Which engine the web_search tool uses.',
  webSearchProvider: 'Search engine',
  webSearchProviderHint: 'Google needs no key: it searches in a hidden page of the built-in browser. Applies to the next search.',
  webSearchFallback: 'Fall back to other engines',
  webSearchFallbackHint: 'When the chosen engine is rate-limited, blocked or unavailable, try the others (Google, Google API, DuckDuckGo, Exa, Perplexity).',
} satisfies Record<string, string>
