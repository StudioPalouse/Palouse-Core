# Palouse — contributor & agent guide

## Copy & voice

**No em-dashes (—, U+2014) in user-facing copy. Ever.** This applies to web UI text,
email templates, CLI output, API error messages, log warnings, and any marketing/site
copy. Em-dashes read as AI-generated and are off-brand.

- Rewrite with proper punctuation instead: a period, comma, colon, semicolon, or
  parentheses. Example: `Sync queued. Tasks appear in the inbox…` not
  `Sync queued — tasks appear…`.
- For empty-value UI placeholders (the "no value" glyph in stat/table cells), use an
  en-dash `–` (U+2013), not an em-dash. This is the established convention
  (`apps/web/src/components/usage-summary-cards.tsx`, `lib/handoff-meta.ts`, `lib/task-meta.ts`).

Scope is user-facing copy. Code comments and internal `docs/*.md` are not bound by this
rule, but prefer to avoid em-dashes there too for consistency.
