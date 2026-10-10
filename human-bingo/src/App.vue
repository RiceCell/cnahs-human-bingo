<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CARD, FREE_SQUARE, shortText } from './bingoCard'

type Player = { id: string; name: string; code: string; bingo_at: string | null }
type Claim = { square_index: number; signed_by: string }
type Board = {
  winners: { id: string; name: string; bingo_at: string }[]
  top: { id: string; name: string; filled: number }[]
  totalPlayers: number
  totalClaims: number
}

const LINES = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
]
const STORAGE_KEY = 'human-bingo-player-id'

const player = ref<Player | null>(null)
const claims = ref<Claim[]>([])
const board = ref<Board | null>(null)
const tab = ref<'card' | 'board'>('card')
const nameInput = ref('')
const signerCode = ref('')
const sheet = ref<number | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const logoFailed = ref(false)

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Something went wrong'), { status: res.status })
  return body as T
}

const claimedBy = computed(() => new Map(claims.value.map((c) => [c.square_index, c.signed_by])))
const isFilled = (i: number) => i === FREE_SQUARE || claimedBy.value.has(i)

const winningSquares = computed(() => {
  const set = new Set<number>()
  for (const line of LINES) {
    if (line.every(isFilled)) line.forEach((i) => set.add(i))
  }
  return set
})
const hasBingo = computed(() => winningSquares.value.size > 0)

async function join() {
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ player: Player; claims: Claim[] }>('/api/join', {
      method: 'POST',
      body: JSON.stringify({ name: nameInput.value }),
    })
    player.value = r.player
    claims.value = r.claims
    localStorage.setItem(STORAGE_KEY, r.player.id)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function restore() {
  const id = localStorage.getItem(STORAGE_KEY)
  if (id) {
    try {
      const r = await api<{ player: Player; claims: Claim[] }>(`/api/card?id=${id}`)
      player.value = r.player
      claims.value = r.claims
    } catch (e) {
      // Only forget the card if the server says it doesn't exist
      if ((e as { status?: number }).status === 404) localStorage.removeItem(STORAGE_KEY)
      else error.value = 'Could not load your card. Check your connection and refresh.'
    }
  }
  loading.value = false
}

function openSheet(i: number) {
  sheet.value = i
  signerCode.value = ''
  error.value = ''
}
function closeSheet() {
  sheet.value = null
  error.value = ''
}

async function mutate(method: 'POST' | 'DELETE') {
  if (sheet.value === null || !player.value) return
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ claims: Claim[]; bingoAt: string | null }>('/api/claim', {
      method,
      body: JSON.stringify({
        playerId: player.value.id,
        squareIndex: sheet.value,
        signerCode: signerCode.value,
      }),
    })
    claims.value = r.claims
    player.value.bingo_at = r.bingoAt
    closeSheet()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

// ---- Leaderboard polling: only while the Leaderboard tab is open and the page is visible ----
let timer: number | undefined

async function loadBoard() {
  try {
    board.value = await api<Board>('/api/leaderboard')
  } catch {
    /* keep the last good data */
  }
}

function syncPolling() {
  const active = tab.value === 'board' && document.visibilityState === 'visible'
  if (active && timer === undefined) {
    loadBoard()
    // Random interval per phone so 1,000 clients don't all fire on the same second
    timer = window.setInterval(loadBoard, 8000 + Math.random() * 4000)
  } else if (!active && timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

watch(tab, syncPolling)
onMounted(() => {
  restore()
  document.addEventListener('visibilitychange', syncPolling)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', syncPolling)
  if (timer !== undefined) clearInterval(timer)
})
</script>

<template>
  <main class="app">
    <p v-if="loading" class="muted center">Loading…</p>

    <form v-else-if="!player" class="panel join" @submit.prevent="join">
      <h1>CNAHS Human Bingo</h1>
      <p class="muted">
        Find people who match the squares. To sign a square, type that person's 4-letter code.
      </p>
      <input v-model="nameInput" maxlength="40" placeholder="Your name (and nickname)" autocomplete="name" required />
      <button :disabled="busy">Get my card</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>

    <template v-else>
      <header>
        <div>
          <strong>{{ player.name }}</strong>
          <div class="muted small">{{ claims.length }}/24 signed</div>
        </div>
        <div class="code-badge">Your code <b>{{ player.code }}</b></div>
      </header>

      <div v-if="hasBingo" class="banner">🎉 BINGO! Show this screen to the host.</div>

      <nav class="tabs">
        <button :class="{ on: tab === 'card' }" @click="tab = 'card'">My card</button>
        <button :class="{ on: tab === 'board' }" @click="tab = 'board'">Leaderboard</button>
      </nav>

      <section v-if="tab === 'card'" class="grid">
        <template v-for="(text, i) in CARD" :key="i">
          <div v-if="i === FREE_SQUARE" class="cell free" :class="{ win: winningSquares.has(i) }">
            <img v-if="!logoFailed" src="/cnahs-logo.png" alt="CNAHS" @error="logoFailed = true" />
            <b v-else>CNAHS</b>
          </div>

          <button
            v-else
            class="cell"
            :class="[(i % 5) % 2 ? 'gold' : 'red', { signed: claimedBy.has(i), win: winningSquares.has(i) }]"
            @click="openSheet(i)"
          >
            <template v-if="claimedBy.has(i)">
              <span class="check">✓</span>
              <b>{{ claimedBy.get(i) }}</b>
            </template>
            <span v-else>{{ shortText(text) }}</span>
          </button>
        </template>
      </section>

      <section v-else class="panel board">
        <h2>First to bingo</h2>
        <ol v-if="board?.winners.length">
          <li v-for="w in board.winners" :key="w.id">{{ w.name }}</li>
        </ol>
        <p v-else class="muted">No bingo yet. Be the first!</p>

        <h2>Most squares</h2>
        <ol v-if="board?.top.length">
          <li v-for="p in board.top" :key="p.id">{{ p.name }} · {{ p.filled }}/24</li>
        </ol>

        <p v-if="board" class="muted small">
          {{ board.totalPlayers }} players · {{ board.totalClaims }} signatures · refreshes every few seconds
        </p>
        <p v-else class="muted">Loading…</p>
      </section>

      <div v-if="sheet !== null" class="overlay" @click.self="closeSheet">
        <div class="sheet">
          <p class="trait">{{ CARD[sheet] }}</p>

          <template v-if="claimedBy.has(sheet)">
            <p class="muted">Signed by {{ claimedBy.get(sheet) }}</p>
            <button class="danger" :disabled="busy" @click="mutate('DELETE')">Remove signature</button>
          </template>

          <template v-else>
            <input
              v-model="signerCode"
              class="code-input"
              maxlength="4"
              placeholder="Their code"
              autocapitalize="characters"
              autocomplete="off"
            />
            <button :disabled="busy || signerCode.trim().length < 4" @click="mutate('POST')">Save</button>
          </template>

          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </div>
    </template>
  </main>
</template>

<style>
:root { --red: #8e1a0e; --gold: #e9a723; --orange: #e67e1f; --cream: #fff4dc; --ink: #2a0c07; }
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, sans-serif; color: var(--ink);
  min-height: 100dvh; background: linear-gradient(160deg, #f26b5b, #f28b3a 55%, #f2a53a) fixed;
}
.app { max-width: 480px; margin: 0 auto; padding: 12px; min-height: 100dvh; }
.panel { background: var(--cream); border-radius: 14px; padding: 14px; }
.muted { color: rgba(42, 12, 7, 0.7); }
.small { font-size: 12px; }
.center { text-align: center; }
.error { color: #b3261e; font-size: 14px; font-weight: 600; }
h1 { margin: 8px 0 4px; color: var(--red); }
h2 { font-size: 16px; margin: 16px 0 4px; color: var(--red); }
input { width: 100%; padding: 12px; font-size: 16px; border: 1px solid #d9b98a; border-radius: 10px; margin: 8px 0; background: #fff; }
.code-input { text-align: center; font-size: 24px; letter-spacing: 6px; text-transform: uppercase; }
button { font: inherit; border: 0; border-radius: 10px; padding: 12px; background: var(--red); color: #fff; width: 100%; font-weight: 600; }
button:disabled { opacity: 0.5; }
header { display: flex; justify-content: space-between; align-items: center; padding: 4px 2px 8px; color: #fff; }
header .muted { color: rgba(255, 255, 255, 0.85); }
.code-badge { background: var(--red); color: #fff; border-radius: 10px; padding: 6px 10px; font-size: 12px; text-align: center; }
.code-badge b { display: block; font-size: 22px; letter-spacing: 3px; }
.banner { background: #ffe27a; color: var(--red); border-radius: 10px; padding: 10px; text-align: center; font-weight: 800; margin-bottom: 8px; }
.tabs { display: flex; gap: 6px; margin-bottom: 8px; }
.tabs button { background: rgba(255, 255, 255, 0.6); color: var(--red); padding: 8px; }
.tabs button.on { background: var(--red); color: #fff; }

.grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; background: var(--orange); padding: 6px; border-radius: 10px; }
.cell {
  aspect-ratio: 1; padding: 3px; border-radius: 4px; display: flex; flex-direction: column;
  justify-content: center; align-items: center; gap: 2px; text-align: center; overflow: hidden;
  font-size: clamp(8px, 2.5vw, 11px); line-height: 1.12; font-weight: 700; word-break: break-word;
}
.cell.red { background: var(--red); color: #fff; }
.cell.gold { background: var(--gold); color: #4a0d06; }
.cell.signed { background: var(--cream); color: var(--red); }
.cell.signed .check { font-size: 14px; color: #1b7a3d; }
.cell.free { background: var(--red); padding: 2px; }
.cell.free img { width: 100%; height: 100%; object-fit: contain; }
.cell.win { background: #ffe27a; color: var(--red); outline: 3px solid var(--red); outline-offset: -3px; }

.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: flex-end; }
.sheet {
  width: 100%; background: var(--cream); padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  border-radius: 16px 16px 0 0; display: flex; flex-direction: column; gap: 4px;
}
.trait { font-weight: 800; margin: 0 0 4px; color: var(--red); }
.danger { background: #b3261e; margin-top: 4px; }
.board ol { margin: 0; padding-left: 20px; }
</style>