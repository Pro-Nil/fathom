/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-26.1'

/** The complete welcome notice. */
export const WELCOME_NOTICE_COPY = {
  en: {
    title: 'Welcome to Pentest Harness',
    body: 'Pentest Harness is a professional security testing workspace for authorized penetration tests, bug bounty research, security labs, and CTF engagements. Test only targets you own or are explicitly authorized to assess.\n\nOpen source, open, reusable, and composable — welcome to the community.',
    continueLabel: 'Continue',
  },
} as const
