/**
 * Crawlers asked to stay away in robots.txt (decision 2026-11-24). This is a request, not enforcement: nothing in
 * Caddy or the API blocks any user agent, so browsers, in-app WebViews, link-preview fetchers and search engines are
 * never affected. Search engines (Googlebot, Bingbot, DuckDuckBot, Applebot, YandexBot, Baiduspider, ...) are NOT
 * listed, and neither are the share-card fetchers (facebookexternalhit, WhatsApp, Twitterbot, TelegramBot,
 * LinkedInBot, Slackbot).
 *
 * Sources (checked 2026-11-24):
 * - OpenAI: https://developers.openai.com/api/docs/bots (GPTBot = training, ChatGPT-User = user-triggered visits)
 * - Meta: https://developers.facebook.com/docs/sharing/webmasters/web-crawlers (meta-externalagent = AI training;
 *   facebookexternalhit is the link-preview fetcher and stays allowed)
 * - Google: https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers (Google-Extended is a
 *   robots.txt-only token for Gemini training; blocking it does not affect Search)
 * - Anthropic: https://support.anthropic.com/en/articles/8896518 (ClaudeBot; anthropic-ai is the older name)
 * - Common Crawl https://commoncrawl.org/ccbot (CCBot); Perplexity https://docs.perplexity.ai/guides/bots
 *   (PerplexityBot); Amazon https://developer.amazon.com/amazonbot (Amazonbot); ByteDance Bytespider; Cohere
 *   cohere-ai; Diffbot https://docs.diffbot.com/docs/getting-started-with-diffbot-crawler
 * - SEO tools: AhrefsBot, SemrushBot, MJ12bot (Majestic), DotBot (Moz), BLEXBot (WebMeUp), PetalBot (Huawei),
 *   DataForSeoBot, each documented on its owner's site.
 *
 * Admin editing (hard rule 8) is queued in docs/questions-for-user.md: robots.txt is built per request-free at build
 * time, so a setting would need a cached API read; the list lives here until that is approved.
 */
export const AI_TRAINING_CRAWLERS: readonly string[] = [
  'GPTBot',
  'ChatGPT-User',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Bytespider',
  'PerplexityBot',
  'Amazonbot',
  'meta-externalagent',
  'cohere-ai',
  'Diffbot',
];

export const SEO_TOOL_CRAWLERS: readonly string[] = [
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'BLEXBot',
  'PetalBot',
  'DataForSeoBot',
];

export const BLOCKED_CRAWLERS: readonly string[] = [...AI_TRAINING_CRAWLERS, ...SEO_TOOL_CRAWLERS];
