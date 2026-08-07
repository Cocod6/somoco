// Somoco — Polymarket browse API
// GET /api/polymarket?limit=20&minVolume=10000&category=crypto&search=bitcoin&minDays=7
//
// Returns live Polymarket markets already mapped into Somoco's shape, ready to
// preview and import. Read-only: nothing is written and no AI is called, so
// this endpoint costs nothing to hit. The AI parse happens once, at import.
//
// Route Handlers are uncached by default in Next 16, which is what we want —
// Polymarket odds move by the minute and a cached response would show stale
// prices. (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md)

import { NextResponse } from 'next/server'
import { fetchPolymarketDrafts } from '@/lib/predictions/polymarket'
import { normalizeCategory } from '@/lib/predictions/categories'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const limitParam = Number(params.get('limit'))
  const minVolumeParam = Number(params.get('minVolume'))
  const minDaysParam = Number(params.get('minDays'))

  try {
    const result = await fetchPolymarketDrafts({
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      // 0 is meaningful here (show everything), so only ignore NaN/negatives.
      minVolume: Number.isFinite(minVolumeParam) && minVolumeParam >= 0 ? minVolumeParam : undefined,
      minDaysToResolution:
        Number.isFinite(minDaysParam) && minDaysParam >= 0 ? minDaysParam : undefined,
      category: normalizeCategory(params.get('category')) ?? undefined,
      search: params.get('search') ?? undefined,
    })

    return NextResponse.json(result)
  } catch (err) {
    // Polymarket being down must read as "the source is unavailable", not as a
    // Somoco bug — the admin importing needs to know which side failed.
    console.error('polymarket fetch failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not reach Polymarket.' },
      { status: 502 }
    )
  }
}
