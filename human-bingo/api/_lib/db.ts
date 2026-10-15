import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseServiceRoleKey)

export const db = hasSupabaseConfig
    ? createClient(supabaseUrl!, supabaseServiceRoleKey!, { auth: { persistSession: false } })
    : null

export function getDb() {
    if (!db) {
        throw new Error('Missing Supabase config. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your local .env.local or Vercel environment.')
    }
    return db
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The center square is free, so players never sign it. Keep in sync with src/bingoCard.ts.
export const FREE_SQUARE = 12

const LINES = [
    [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
    [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
    [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
]

export function hasBingo(filled: number[]): boolean {
    const set = new Set([...filled, FREE_SQUARE])
    return LINES.some((line) => line.every((i) => set.has(i)))
}

// Recomputes bingo on the server so players can't fake it from the client.
export async function syncBingo(playerId: string) {
    const db = getDb()
    const { data: claims, error } = await db
        .from('claims')
        .select('square_index, signed_by')
        .eq('player_id', playerId)
        .eq('status', 'approved')
    if (error) throw error

    const { data: player, error: playerError } = await db
        .from('players')
        .select('bingo_at')
        .eq('id', playerId)
        .single()
    if (playerError) throw playerError

    const bingo = hasBingo(claims.map((c) => c.square_index))
    const bingoAt = bingo ? player.bingo_at ?? new Date().toISOString() : null

    if (bingoAt !== player.bingo_at) {
        await db.from('players').update({ bingo_at: bingoAt }).eq('id', playerId)
    }
    return { claims, bingoAt }
}