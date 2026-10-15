import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, UUID } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    const id = String(req.query.id ?? '')
    if (!UUID.test(id)) return res.status(400).json({ error: 'Bad id' })

    const { data: player, error: playerError } = await db
        .from('players')
        .select('id, name, code, bingo_at')
        .eq('id', id)
        .maybeSingle()
    if (playerError) return res.status(500).json({ error: playerError.message })
    if (!player) return res.status(404).json({ error: 'Card not found' })

    const { data: claims, error: claimsError } = await db
        .from('claims')
        .select('square_index, signed_by')
        .eq('player_id', id)
        .eq('status', 'approved')
    if (claimsError) return res.status(500).json({ error: claimsError.message })

    const { data: requests, error: requestsError } = await db
        .from('claims')
        .select('id, player_id, square_index')
        .eq('signer_id', id)
        .eq('status', 'pending')
    if (requestsError) return res.status(500).json({ error: requestsError.message })

    const requesterIds = [...new Set((requests ?? []).map((request) => request.player_id))]
    const { data: requesters, error: requestersError } = requesterIds.length
        ? await db.from('players').select('id, name').in('id', requesterIds)
        : { data: [], error: null }
    if (requestersError) return res.status(500).json({ error: requestersError.message })

    const requesterNames = new Map((requesters ?? []).map((requester) => [requester.id, requester.name]))
    const pendingRequests: { id: string; square_index: number; claimant_name: string }[] = []
    for (const request of requests ?? []) {
        const claimantName = requesterNames.get(request.player_id)
        if (claimantName === undefined) {
            return res.status(500).json({ error: 'Could not load a pending signature requester' })
        }
        pendingRequests.push({
            id: request.id,
            square_index: request.square_index,
            claimant_name: claimantName,
        })
    }

    return res.status(200).json({ player, claims: claims ?? [], requests: pendingRequests })
}