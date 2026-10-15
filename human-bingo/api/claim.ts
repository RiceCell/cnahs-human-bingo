import type { VercelRequest, VercelResponse } from '@vercel/node'
import { FREE_SQUARE, getDb, syncBingo, UUID } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    if (req.method !== 'POST' && req.method !== 'DELETE') {
        return res.status(405).json({ error: 'POST or DELETE only' })
    }

    const { playerId, squareIndex, signerCode } = req.body ?? {}
    if (!UUID.test(String(playerId))) return res.status(400).json({ error: 'Bad player id' })
    if (!Number.isInteger(squareIndex) || squareIndex < 0 || squareIndex > 24) {
        return res.status(400).json({ error: 'Bad square' })
    }
    if (squareIndex === FREE_SQUARE) return res.status(400).json({ error: 'That square is free' })

    let requestSentTo: string | undefined
    try {
        if (req.method === 'POST') {
            const code = String(signerCode ?? '').trim().toUpperCase()
            if (!code) return res.status(400).json({ error: "Enter the other person's code" })

            const { data: signer, error: signerError } = await db
                .from('players')
                .select('id, name')
                .eq('code', code)
                .maybeSingle()
            if (signerError) throw signerError
            if (!signer) return res.status(404).json({ error: 'No player with that code' })
            if (signer.id === playerId) return res.status(400).json({ error: "You can't sign your own card" })
            requestSentTo = signer.name

            const { error } = await db.from('claims').insert({
                player_id: playerId,
                square_index: squareIndex,
                signed_by: signer.name,
                signer_id: signer.id,
                status: 'pending',
            })
            if (error) {
                if (error.code === '23505') {
                    const dupSigner = error.message.includes('one_signature_per_person')
                    return res.status(409).json({
                        error: dupSigner
                            ? `${signer.name} already signed another square on your card`
                            : 'That square is already signed',
                    })
                }
                throw error
            }
        } else {
            const { error } = await db
                .from('claims')
                .delete()
                .eq('player_id', playerId)
                .eq('square_index', squareIndex)
            if (error) throw error
        }

        const result = await syncBingo(playerId)
        return res.status(200).json({
            ...result,
            ...(requestSentTo ? { requestSentTo } : {}),
        })
    } catch (e) {
        return res.status(500).json({ error: (e as Error).message })
    }
}