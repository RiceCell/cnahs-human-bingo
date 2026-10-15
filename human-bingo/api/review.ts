import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, syncBingo, UUID } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const { playerId, code, requestId, decision } = req.body ?? {}
    if (!UUID.test(String(playerId))) return res.status(400).json({ error: 'Bad player id' })

    // claims.id is an integer, not a UUID
    const claimId = Number(requestId)
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
        return res.status(400).json({ error: 'Bad request id' })
    }

    if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ error: 'Bad decision' })
    }
    const ownerCode = String(code ?? '').trim().toUpperCase()
    if (!ownerCode) return res.status(400).json({ error: 'Enter your code to verify this request' })

    try {
        const db = getDb()
        const { data: owner, error: ownerError } = await db
            .from('players')
            .select('id')
            .eq('id', playerId)
            .eq('code', ownerCode)
            .maybeSingle()
        if (ownerError) throw ownerError
        if (!owner) return res.status(403).json({ error: 'That code does not match your card' })

        const { data: request, error: requestError } = await db
            .from('claims')
            .select('id, player_id')
            .eq('id', claimId)
            .eq('signer_id', owner.id)
            .eq('status', 'pending')
            .maybeSingle()
        if (requestError) throw requestError
        if (!request) return res.status(404).json({ error: 'This request is no longer waiting for review' })

        if (decision === 'approve') {
            const { data: updated, error: updateError } = await db
                .from('claims')
                .update({ status: 'approved' })
                .eq('id', request.id)
                .eq('signer_id', owner.id)
                .eq('status', 'pending')
                .select('id')
                .maybeSingle()
            if (updateError) throw updateError
            if (!updated) return res.status(409).json({ error: 'This request was already reviewed' })
            await syncBingo(request.player_id)
        } else {
            const { data: deleted, error: deleteError } = await db
                .from('claims')
                .delete()
                .eq('id', request.id)
                .eq('signer_id', owner.id)
                .eq('status', 'pending')
                .select('id')
                .maybeSingle()
            if (deleteError) throw deleteError
            if (!deleted) return res.status(409).json({ error: 'This request was already reviewed' })
        }

        return res.status(200).json({ ok: true })
    } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
    }
}