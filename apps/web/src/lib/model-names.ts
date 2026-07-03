// Business users shouldn't have to read raw model ids like
// "claude-sonnet-4-5-20250929". Known families get a proper display name;
// anything unrecognized passes through unchanged rather than guessing.

const CLAUDE_FAMILIES = new Set(['opus', 'sonnet', 'haiku', 'fable', 'mythos']);

/** "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5", "gpt-4o-mini" → "GPT-4o Mini". */
export function formatModelName(id: string): string {
  // Ignore provider/route prefixes ("anthropic/claude-…", "us.anthropic.claude-…-v1:0").
  const bare = id
    .split('/')
    .pop()!
    .replace(/^\w+\.anthropic\./, '');
  const tokens = bare
    .toLowerCase()
    .split('-')
    // Trailing date stamps and bedrock-style ":0" suffixes are noise.
    .filter((t) => !/^\d{8}$/.test(t))
    .map((t) => t.replace(/:\d+$/, ''));

  if (tokens[0] === 'claude') {
    const family = tokens.find((t) => CLAUDE_FAMILIES.has(t));
    if (family) {
      const version = tokens.filter((t) => /^\d+$/.test(t)).join('.');
      return ['Claude', capitalize(family), version].filter(Boolean).join(' ');
    }
  }

  if (tokens[0] === 'gpt' || /^o\d$/.test(tokens[0]!)) {
    const head = tokens[0] === 'gpt' ? `GPT-${tokens[1] ?? ''}` : tokens[0]!;
    return [head, ...tokens.slice(tokens[0] === 'gpt' ? 2 : 1).map(capitalize)].join(' ').trim();
  }

  if (['gemini', 'mistral', 'llama'].includes(tokens[0]!)) {
    return tokens.map((t) => (/\d/.test(t) ? t : capitalize(t))).join(' ');
  }

  return id;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
