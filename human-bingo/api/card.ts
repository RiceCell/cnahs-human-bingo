import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, UUID } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    const id = String(req.query.id ?? '')
    if (!UUID.test(id)) return res.status(400).json({ error: 'Bad id' })

    const { data: player } = await db
        .from('players')
        .select('id, name, code, bingo_at')
        .eq('id', id)
        .maybeSingle()
    if (!player) return res.status(404).json({ error: 'Card not found' })

    const { data: claims } = await db
        .from('claims')
        .select('square_index, signed_by')
        .eq('player_id', id)

    return res.status(200).json({ player, claims: claims ?? [] })
}