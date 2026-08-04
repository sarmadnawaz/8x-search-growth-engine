import { loadAllProperties } from '@/lib/engine/config'

export const dynamic = 'force-dynamic'

export default function Home() {
  const properties = loadAllProperties()

  return (
    <main>
      <h1 style={{ fontSize: 18 }}>Search Growth Engine</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
        {properties.filter((p) => p.ok).length} configured properties. The dashboard arrives with
        the collect and detect stages; this page confirms configs load.
      </p>
      <ul style={{ marginTop: 16, paddingLeft: 18 }}>
        {properties.map((p) =>
          p.ok ? (
            <li key={p.config.domain}>
              <strong>{p.config.domain}</strong> — {p.config.name} ({p.config.markets.length} market
              {p.config.markets.length === 1 ? '' : 's'})
            </li>
          ) : (
            <li key={p.domain} style={{ color: 'var(--critical)' }}>
              {p.domain} — invalid config: {p.error}
            </li>
          ),
        )}
      </ul>
    </main>
  )
}
