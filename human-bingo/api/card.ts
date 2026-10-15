import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, UUID } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    const id = String(req.query.id ?? '')
    if (!UUID.test(id)) return res.status(400).json({ error: 'Bad id' })

    // Per-player data (includes the player's code): never store it in a shared cache.
    res.setHeader('Cache-Control', 'private, no-store')

    // Three independent lookups run at the same time instead of one after another.
    const [playerResult, ownResult, incomingResult] = await Promise.all([
        db.from('players').select('id, name, code, bingo_at').eq('id', id).maybeSingle(),
        // The player's own claims, approved and pending together
        db.from('claims').select('square_index, signed_by, status').eq('player_id', id),
        // Requests waiting for this player to verify
        db.from('claims').select('id, player_id, square_index').eq('signer_id', id).eq('status', 'pending'),
    ])

    if (playerResult.error) return res.status(500).json({ error: playerResult.error.message })
    if (!playerResult.data) return res.status(404).json({ error: 'Card not found' })
    if (ownResult.error) return res.status(500).json({ error: ownResult.error.message })
    if (incomingResult.error) return res.status(500).json({ error: incomingResult.error.message })

    const player = playerResult.data
    const own = ownResult.data ?? []
    const claims = own
        .filter((claim) => claim.status === 'approved')
        .map(({ square_index, signed_by }) => ({ square_index, signed_by }))
    const pending = own
        .filter((claim) => claim.status === 'pending')
        .map(({ square_index, signed_by }) => ({ square_index, signed_by }))

    const requests = incomingResult.data ?? []
    const pendingRequests: { id: number; square_index: number; claimant_name: string }[] = []

    if (requests.length) {
        const requesterIds = [...new Set(requests.map((request) => request.player_id))]
        const { data: requesters, error: requestersError } = await db
            .from('players')
            .select('id, name')
            .in('id', requesterIds)
        if (requestersError) return res.status(500).json({ error: requestersError.message })

        const requesterNames = new Map((requesters ?? []).map((requester) => [requester.id, requester.name]))
        for (const request of requests) {
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
    }

    return res.status(200).json({ player, claims, pending, requests: pendingRequests })
}