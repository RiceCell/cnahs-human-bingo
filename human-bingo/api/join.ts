import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb } from './_lib/db.js'

// No 0/O, 1/I/L so codes are easy to read and type on a phone
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function makeCode(length = 4): string {
    let code = ''
    for (let i = 0; i < length; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    return code
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getDb()
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

    const name = String(req.body?.name ?? '').trim().slice(0, 40)
    if (!name) return res.status(400).json({ error: 'Please enter your name' })

    for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await db
            .from('players')
            .insert({ name, code: makeCode() })
            .select('id, name, code, bingo_at')
            .single()

        if (!error) return res.status(200).json({ player: data, claims: [] })
        if (error.code !== '23505') return res.status(500).json({ error: error.message })
        // 23505 = code collision, loop and try a new code
    }
    return res.status(500).json({ error: 'Could not create your card, please try again' })
}