import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb } from './_lib/db.js'

export default async function handler(_req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    const [winners, top, players, claims] = await Promise.all([
        db.from('players').select('id, name, bingo_at')
            .not('bingo_at', 'is', null)
            .order('bingo_at', { ascending: true })
            .limit(10),
        db.from('leaderboard').select('id, name, filled')
            .order('filled', { ascending: false })
            .limit(10),
        db.from('players').select('id', { count: 'exact', head: true }),
        db.from('claims').select('id', { count: 'exact', head: true }),
    ])

    // Shared CDN cache so ~700 phones do not each hit Supabase. Clients poll ~20s.
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=45')
    return res.status(200).json({
        winners: winners.data ?? [],
        top: top.data ?? [],
        totalPlayers: players.count ?? 0,
        totalClaims: claims.count ?? 0,
    })
}