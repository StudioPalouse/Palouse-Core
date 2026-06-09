import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>ReqOps</h1>
      <p style={{ color: '#9aa3ad', marginBottom: '2rem' }}>
        Team task aggregation + agentic handoff. Self-host first.
      </p>
      <nav style={{ display: 'flex', gap: '1rem' }}>
        <Link href="/sign-in" style={linkStyle}>
          Sign in
        </Link>
        <Link href="/sign-up" style={linkStyle}>
          Sign up
        </Link>
        <Link href="/workspaces/new" style={linkStyle}>
          Create workspace
        </Link>
      </nav>
    </main>
  );
}

const linkStyle = {
  padding: '0.5rem 0.9rem',
  borderRadius: 6,
  border: '1px solid #2a2f36',
  color: '#e6e6e6',
  textDecoration: 'none',
} as const;
