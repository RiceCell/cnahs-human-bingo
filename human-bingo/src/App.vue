<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { FREE_SQUARE, SQUARES } from './bingoCard'

type Player = { id: string; name: string; code: string; bingo_at: string | null }
type Claim = { square_index: number; signed_by: string }
type ReviewRequest = { id: string; square_index: number; claimant_name: string }
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
const TOTAL = 24
const BOARD_POLL_BASE = 16000

const player = ref<Player | null>(null)
const claims = ref<Claim[]>([])
const pendingRequests = ref<ReviewRequest[]>([])
const board = ref<Board | null>(null)
const tab = ref<'card' | 'board'>('card')
const nameInput = ref('')
const signerCode = ref('')
const sheet = ref<number | null>(null)
const showCode = ref(false)
const celebrate = ref(false)
const justSigned = ref<number | null>(null)
const codeInput = ref<HTMLInputElement | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const logoFailed = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const boardFailed = ref(false)
const cardFailed = ref(false)

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? 'Something went wrong'), { status: res.status })
  return body as T
}

// ---- Card state ----
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

const toBingo = computed(() =>
  Math.min(...LINES.map((line) => line.filter((i) => !isFilled(i)).length))
)
const progressPct = computed(() => Math.round((claims.value.length / TOTAL) * 100))
const goalText = computed(() =>
  toBingo.value === 1 ? 'One more signature for a bingo' : `${toBingo.value} more signatures for a bingo`
)

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
const signedName = (i: number) => firstName(claimedBy.value.get(i) ?? '')

function tileLabel(i: number) {
  const who = claimedBy.value.get(i)
  return `${SQUARES[i].prompt}. ${who ? `Signed by ${who}.` : 'Not signed yet.'}`
}

const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
const formatTime = (iso: string) => timeFmt.format(new Date(iso))

// ---- Actions ----
async function join() {
  if (!online.value) {
    error.value = "You're offline. Check your signal and try again."
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const r = await api<{ player: Player; claims: Claim[]; requests: ReviewRequest[] }>('/api/join', {
      method: 'POST',
      body: JSON.stringify({ name: nameInput.value }),
    })
    player.value = r.player
    claims.value = r.claims
    pendingRequests.value = r.requests
    localStorage.setItem(STORAGE_KEY, r.player.id)
    syncPolling()
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
      const r = await api<{ player: Player; claims: Claim[]; requests: ReviewRequest[] }>(`/api/card?id=${id}`)
      player.value = r.player
      claims.value = r.claims
      pendingRequests.value = r.requests
    } catch (e) {
      // Only forget the card if the server says it doesn't exist
      if ((e as { status?: number }).status === 404) localStorage.removeItem(STORAGE_KEY)
      else error.value = 'Could not load your card. Check your connection and refresh.'
    }
  }
  loading.value = false
  syncPolling()
}

async function loadCard() {
  if (!player.value) return
  try {
    const r = await api<{ player: Player; claims: Claim[]; requests: ReviewRequest[] }>(
      `/api/card?id=${player.value.id}`
    )
    const previousSquares = new Set(claims.value.map((claim) => claim.square_index))
    const hadBingo = hasBingo.value
    player.value = r.player
    claims.value = r.claims
    pendingRequests.value = r.requests
    cardFailed.value = false
    const newlySigned = r.claims.find((claim) => !previousSquares.has(claim.square_index))
    if (newlySigned) flashSigned(newlySigned.square_index)
    if (!hadBingo && hasBingo.value) celebrate.value = true
  } catch {
    cardFailed.value = true
  }
}

function openSheet(i: number) {
  sheet.value = i
  signerCode.value = ''
  error.value = ''
  nextTick(() => codeInput.value?.focus())
}
function closeSheet() {
  sheet.value = null
  error.value = ''
}

function flashSigned(i: number) {
  justSigned.value = i
  window.setTimeout(() => {
    if (justSigned.value === i) justSigned.value = null
  }, 1200)
}

async function mutate(method: 'POST' | 'DELETE') {
  if (sheet.value === null || !player.value) return
  if (!online.value) {
    error.value = "You're offline. Check your signal and try again."
    return
  }
  const square = sheet.value
  busy.value = true
  error.value = ''
  try {
    const r = await api<{ claims: Claim[]; bingoAt: string | null; requestSentTo?: string }>('/api/claim', {
      method,
      body: JSON.stringify({
        playerId: player.value.id,
        squareIndex: square,
        signerCode: signerCode.value,
      }),
    })
    claims.value = r.claims
    player.value.bingo_at = r.bingoAt
    closeSheet()
    if (method === 'POST') {
      notice.value = `Signature request sent to ${r.requestSentTo ?? 'the code owner'}. It will count once they verify it.`
    } else {
      notice.value = 'Signature removed.'
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function reviewRequest(request: ReviewRequest, decision: 'approve' | 'reject') {
  if (!player.value) return
  if (!online.value) {
    error.value = "You're offline. Check your signal and try again."
    return
  }

  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api<{ ok: true }>('/api/review', {
      method: 'POST',
      body: JSON.stringify({
        playerId: player.value.id,
        code: player.value.code,
        requestId: request.id,
        decision,
      }),
    })
    notice.value = decision === 'approve' ? 'Signature verified.' : 'Signature request declined.'
    await loadCard()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

// ---- Leaderboard polling: only while the Leaderboard tab is open and the page is visible ----
let timer: number | undefined

function pollDelay() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  const base = connection?.saveData ? 28000 : BOARD_POLL_BASE
  return base + Math.random() * 8000
}

async function loadBoard() {
  try {
    board.value = await api<Board>('/api/leaderboard')
    boardFailed.value = false
  } catch {
    boardFailed.value = true
  }
}

function stopPolling() {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
}

function syncPolling() {
  const active = player.value !== null && document.visibilityState === 'visible' && online.value
  if (!active) {
    stopPolling()
    return
  }
  if (timer !== undefined) return
  const refresh = tab.value === 'board' ? loadBoard : loadCard
  refresh()
  const tick = () => {
    timer = window.setTimeout(async () => {
      timer = undefined
      if (player.value && document.visibilityState === 'visible' && online.value) {
        await (tab.value === 'board' ? loadBoard() : loadCard())
        tick()
      }
    }, pollDelay())
  }
  tick()
}

function onOnline() {
  online.value = true
  error.value = ''
  syncPolling()
}
function onOffline() {
  online.value = false
  stopPolling()
}

// ---- Keyboard + scroll lock ----
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (celebrate.value) celebrate.value = false
  else if (showCode.value) showCode.value = false
  else if (sheet.value !== null) closeSheet()
}

watch(tab, () => {
  stopPolling()
  syncPolling()
})
watch(
  () => sheet.value !== null || showCode.value || celebrate.value,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  }
)

onMounted(() => {
  restore()
  document.addEventListener('visibilitychange', syncPolling)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', syncPolling)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  stopPolling()
})
</script>

<template>
  <main class="app" :class="{ 'has-dock': player }">
    <p v-if="!online" class="banner" role="status">You're offline. Signatures need a signal.</p>

    <!-- Loading -->
    <div v-if="loading" class="boot">
      <div class="logo-halo">
        <div class="sun-fallback" aria-hidden="true">CNAHS</div>
      </div>
      <p>Loading your card</p>
    </div>

    <!-- Join -->
    <form v-else-if="!player" class="join" @submit.prevent="join">
      <div class="join-hero">
        <div class="logo-halo">
          <img
            v-if="!logoFailed"
            class="join-logo"
            src="/cnahs-logo.png"
            alt="CNAHS"
            width="150"
            height="150"
            decoding="async"
            @error="logoFailed = true"
          />
          <div v-else class="sun-fallback" aria-hidden="true">CNAHS</div>
        </div>
        <p class="kicker">Cebu Institue of Technology University - CNAHS Akwe</p>
        <h1>Human Bingo</h1>
        <p class="lede">Meet someone new, get their code, and fill your card.</p>
      </div>

      <div class="join-card">
        <label for="name">Your name or nickname</label>
        <input id="name" v-model="nameInput" class="field" maxlength="40" autocomplete="name" required />
        <button class="btn" :disabled="busy || !nameInput.trim() || !online">
          {{ busy ? 'Getting your card…' : 'Get my card' }}
        </button>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>

      <ol class="steps">
        <li><span class="n">1</span>Get your card and your 4-letter code.</li>
        <li><span class="n">2</span>Find someone who fits a square.</li>
        <li><span class="n">3</span>Ask for their code; they can verify your signature request.</li>
        <li><span class="n">4</span>Fill a full row, column, or diagonal for a bingo.</li>
      </ol>
    </form>

    <!-- Game -->
    <template v-else>
      <header class="top">
        <img
          v-if="!logoFailed"
          class="mark"
          src="/cnahs-logo.png"
          alt=""
          width="42"
          height="42"
          decoding="async"
          @error="logoFailed = true"
        />
        <span class="who-name">{{ player.name }}</span>
        <button class="chip" type="button" aria-label="Show my code in large letters" @click="showCode = true">
          <span class="chip-label">Your code</span>
          <span class="chip-code">{{ player.code }}</span>
        </button>
      </header>

      <div v-if="hasBingo" class="bingo-strip">Bingo! Show this screen to the host.</div>

      <div class="prog">
        <div class="prog-row">
          <span>{{ claims.length }} of {{ TOTAL }} signed</span>
          <span v-if="!hasBingo">{{ goalText }}</span>
        </div>
        <div
          class="track"
          role="progressbar"
          aria-valuemin="0"
          :aria-valuemax="TOTAL"
          :aria-valuenow="claims.length"
          aria-label="Squares signed"
        >
          <div class="fill" :style="{ width: progressPct + '%' }"></div>
        </div>
      </div>

      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="error && sheet === null" class="error" role="alert">{{ error }}</p>
      <div v-if="cardFailed" class="card-refresh-error">
        <p class="error" role="status">Could not refresh your card or signature requests.</p>
        <button type="button" class="btn ghost" :disabled="!online" @click="loadCard">Try again</button>
      </div>

      <section v-if="tab === 'card' && pendingRequests.length" class="requests" aria-labelledby="requests-title">
        <h2 id="requests-title">Signatures to verify ({{ pendingRequests.length }})</h2>
        <ul class="request-list">
          <li v-for="request in pendingRequests" :key="request.id" class="request">
            <p><strong>{{ request.claimant_name }}</strong> says they match:</p>
            <p class="request-prompt">“{{ SQUARES[request.square_index].prompt }}”</p>
            <div class="request-actions">
              <button
                type="button"
                class="btn ghost"
                :disabled="busy || !online"
                @click="reviewRequest(request, 'reject')"
              >
                Decline
              </button>
              <button
                type="button"
                class="btn"
                :disabled="busy || !online"
                @click="reviewRequest(request, 'approve')"
              >
                {{ busy ? 'Saving…' : 'Verify signature' }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Card -->
      <section v-if="tab === 'card'" class="board-grid" aria-label="Your bingo card">
        <template v-for="(sq, i) in SQUARES" :key="i">
          <div v-if="i === FREE_SQUARE" class="tile free" :class="{ win: winningSquares.has(i) }">
            <img
              v-if="!logoFailed"
              src="/cnahs-logo.png"
              alt="CNAHS free square"
              width="64"
              height="64"
              decoding="async"
              @error="logoFailed = true"
            />
            <span v-else class="free-text">CNAHS</span>
          </div>

          <button
            v-else
            type="button"
            class="tile"
            :class="[(i + Math.floor(i / 5)) % 2 ? 'gold' : 'red', { signed: claimedBy.has(i), win: winningSquares.has(i) }]"
            :aria-label="tileLabel(i)"
            @click="openSheet(i)"
          >
            <span class="tile-label">{{ sq.label }}</span>
            <span class="tile-sign" :class="{ writing: justSigned === i }">{{ signedName(i) }}</span>
          </button>
        </template>
      </section>

      <!-- Leaderboard -->
      <section v-else class="panel">
        <template v-if="board">
          <div class="stats">
            <div class="stat"><b>{{ board.totalPlayers }}</b><span>players joined</span></div>
            <div class="stat"><b>{{ board.totalClaims }}</b><span>squares signed</span></div>
          </div>

          <p v-if="boardFailed" class="error" role="status">Could not refresh. Showing the last list we got.</p>
          <button v-if="boardFailed" type="button" class="btn ghost retry" :disabled="!online" @click="loadBoard">
            Try again
          </button>

          <h2>First to bingo</h2>
          <ol v-if="board.winners.length" class="rank">
            <li v-for="(w, idx) in board.winners" :key="w.id" :class="{ me: w.id === player.id }">
              <span class="pos" :class="'p' + idx">{{ idx + 1 }}</span>
              <div class="info">
                <div class="line">
                  <span class="nm">{{ w.name }}</span>
                  <span v-if="w.id === player.id" class="you">You</span>
                  <span class="val">{{ formatTime(w.bingo_at) }}</span>
                </div>
              </div>
            </li>
          </ol>
          <p v-else class="empty">No bingo yet. The first full line takes the top spot.</p>

          <h2>Most squares signed</h2>
          <ol v-if="board.top.length" class="rank">
            <li v-for="(p, idx) in board.top" :key="p.id" :class="{ me: p.id === player.id }">
              <span class="pos" :class="'p' + idx">{{ idx + 1 }}</span>
              <div class="info">
                <div class="line">
                  <span class="nm">{{ p.name }}</span>
                  <span v-if="p.id === player.id" class="you">You</span>
                  <span class="val">{{ p.filled }} of {{ TOTAL }}</span>
                </div>
                <div class="meter"><i :style="{ width: (p.filled / TOTAL) * 100 + '%' }"></i></div>
              </div>
            </li>
          </ol>
          <p v-else class="empty">No one has signed a square yet.</p>

          <p class="note">Updates about every 20 seconds. Stay on My card while you play to save data.</p>
        </template>
        <template v-else-if="boardFailed">
          <p class="empty">Could not load the leaderboard. Check your signal and try again.</p>
          <button type="button" class="btn" :disabled="!online" @click="loadBoard">Try again</button>
        </template>
        <p v-else class="empty">Loading the leaderboard…</p>
      </section>

      <!-- Bottom navigation -->
      <nav class="dock" aria-label="Sections">
        <div class="dock-inner">
          <button
            type="button"
            class="dock-btn"
            :class="{ on: tab === 'card' }"
            :aria-current="tab === 'card' ? 'page' : undefined"
            @click="tab = 'card'"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
            </svg>
            My card
          </button>
          <button
            type="button"
            class="dock-btn"
            :class="{ on: tab === 'board' }"
            :aria-current="tab === 'board' ? 'page' : undefined"
            @click="tab = 'board'"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
              <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
            </svg>
            Leaderboard
          </button>
        </div>
      </nav>

      <!-- Sign a square -->
      <div v-if="sheet !== null" class="scrim" @click.self="closeSheet">
        <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          <div class="grabber" aria-hidden="true"></div>
          <button type="button" class="close" aria-label="Close" @click="closeSheet">×</button>
          <h2 id="sheet-title" class="prompt">{{ SQUARES[sheet].prompt }}</h2>

          <template v-if="claimedBy.has(sheet)">
            <p class="signed-by">Signed by <span class="ink">{{ claimedBy.get(sheet) }}</span></p>
            <button type="button" class="btn ghost" :disabled="busy" @click="mutate('DELETE')">
              Remove signature
            </button>
          </template>

          <form v-else @submit.prevent="mutate('POST')">
            <label for="signer-code">Ask for their 4-letter code</label>
            <input
              id="signer-code"
              ref="codeInput"
              v-model="signerCode"
              class="field code-field"
              maxlength="4"
              placeholder="ABCD"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn" :disabled="busy || signerCode.trim().length < 4">
              {{ busy ? 'Signing…' : 'Sign square' }}
            </button>
          </form>

          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
      </div>

      <!-- My code, large -->
      <div v-if="showCode" class="scrim" @click.self="showCode = false">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Your code">
          <div class="grabber" aria-hidden="true"></div>
          <button type="button" class="close" aria-label="Close" @click="showCode = false">×</button>
          <p class="prompt">Show this code to someone requesting your signature. You can verify their request on your card.</p>
          <p class="code-plate">{{ player.code }}</p>
          <button type="button" class="btn" @click="showCode = false">Done</button>
        </div>
      </div>

      <!-- Bingo moment -->
      <div v-if="celebrate" class="burst" role="dialog" aria-modal="true" aria-label="Bingo">
        <div class="sunwrap" aria-hidden="true">
          <div class="rays"></div>
          <div class="sun"></div>
        </div>
        <div class="burst-copy">
          <p class="burst-title">Bingo!</p>
          <p class="burst-sub">Show this screen to the host.</p>
        </div>
        <button type="button" class="btn light" @click="celebrate = false">Back to my card</button>
      </div>
    </template>
  </main>
</template>

<style>
:root {
  --ember: #8e1a0e;
  --ember-deep: #3d0f08;
  --marigold: #eda623;
  --papaya: #e8801f;
  --coral: #f2705a;
  --linen: #fff5e4;
  --pen: #1f3fa6;
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --hand: 'Caveat', 'Segoe Print', 'Bradley Hand', cursive;
}

* { box-sizing: border-box; }
button, input { font: inherit; }
body {
  margin: 0;
  min-height: 100dvh;
  font-family: var(--font);
  color: var(--ember-deep);
  background: linear-gradient(180deg, #f2705a 0%, #f58a47 45%, #f5a944 100%) fixed;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}
:focus-visible { outline: 3px solid var(--ember-deep); outline-offset: 2px; }

.app { max-width: 480px; margin: 0 auto; padding: 14px; min-height: 100dvh; }
.app.has-dock { padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
.banner {
  margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; text-align: center;
  font-weight: 700; font-size: 14px; background: #ffe1da; color: #8a1a0b;
}

/* ---------- Shared controls ---------- */
.btn {
  display: block; width: 100%; border: 0; border-radius: 14px; padding: 15px 18px;
  font-size: 18px; font-weight: 800; color: #fff; background: var(--ember);
  box-shadow: 0 4px 0 var(--ember-deep); cursor: pointer;
}
.btn:active { transform: translateY(2px); box-shadow: 0 2px 0 var(--ember-deep); }
.btn:disabled { opacity: 0.45; box-shadow: none; transform: none; cursor: default; }
.btn.ghost { background: transparent; color: #a3200f; box-shadow: inset 0 0 0 2px #a3200f; }
.btn.light { background: var(--linen); color: var(--ember); box-shadow: 0 4px 0 rgba(61, 15, 8, 0.45); max-width: 320px; }

label { display: block; font-weight: 700; font-size: 15px; margin-bottom: 6px; }
.field {
  width: 100%; padding: 14px; margin-bottom: 14px; font-size: 18px; color: var(--ember-deep);
  background: #fff; border: 2px solid #d9a77a; border-radius: 14px;
}
.field:focus-visible { outline: 3px solid var(--marigold); border-color: var(--ember); }
.code-field {
  text-align: center; font-size: 34px; font-weight: 800; letter-spacing: 0.3em; text-indent: 0.3em;
  text-transform: uppercase; padding: 10px 12px;
}
.error {
  margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: #ffe1da;
  color: #8a1a0b; font-weight: 600; font-size: 15px;
}

/* ---------- Loading + join ---------- */
.boot { min-height: 70dvh; display: grid; place-content: center; justify-items: center; gap: 14px; text-align: center; font-weight: 600; }
.sun-fallback {
  width: 124px; height: 124px; border-radius: 50%; display: grid; place-items: center;
  font-size: 24px; font-weight: 800; color: var(--ember);
  background: radial-gradient(circle at 50% 35%, #fff1b8, #f6b93b 60%, #ee9a1e);
}
.logo-halo {
  width: 168px; height: 168px; margin: 0 auto; border-radius: 50%;
  display: grid; place-items: center;
  background: radial-gradient(circle at 50% 42%, rgba(255, 245, 228, 0.95), rgba(255, 245, 228, 0.2) 62%, transparent 70%);
  box-shadow: 0 0 0 6px rgba(255, 245, 228, 0.18);
}
.join { display: flex; flex-direction: column; gap: 22px; padding-top: max(12px, env(safe-area-inset-top)); }
.join-hero { text-align: center; }
.join-logo { display: block; width: 150px; height: 150px; object-fit: contain; }
.kicker {
  margin: 10px 0 0; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
  color: rgba(61, 15, 8, 0.78);
}
.join h1 {
  margin: 8px 0 8px; font-size: clamp(36px, 11vw, 48px); line-height: 1; font-weight: 800; letter-spacing: -0.02em;
}
.lede { margin: 0 auto; max-width: 26ch; font-size: 19px; line-height: 1.3; font-weight: 500; }
.join-card { background: var(--linen); border-radius: 22px; padding: 18px; box-shadow: 0 5px 0 rgba(142, 26, 14, 0.35); }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 16px; font-weight: 500; }
.steps li {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 14px;
  background: rgba(255, 245, 228, 0.38);
}
.n {
  flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  background: var(--linen); color: var(--ember); font-weight: 800; font-size: 15px;
}

/* ---------- Header + progress ---------- */
.top { display: flex; align-items: center; gap: 10px; padding: max(4px, env(safe-area-inset-top)) 0 10px; }
.mark { flex: none; width: 42px; height: 42px; object-fit: contain; }
.who-name { flex: 1; min-width: 0; font-size: 21px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip {
  flex: none; border: 0; border-radius: 12px; padding: 7px 12px 8px; text-align: center; line-height: 1;
  background: var(--linen); color: var(--ember); box-shadow: 0 3px 0 rgba(142, 26, 14, 0.4); cursor: pointer;
}
.chip:active { transform: translateY(2px); box-shadow: 0 1px 0 rgba(142, 26, 14, 0.4); }
.chip-label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; }
.chip-code { display: block; font-size: 24px; font-weight: 800; letter-spacing: 0.14em; margin-right: -0.14em; }

.bingo-strip {
  margin-bottom: 10px; padding: 10px 12px; border-radius: 12px; text-align: center;
  font-weight: 800; background: #ffe27a; color: var(--ember-deep); box-shadow: inset 0 0 0 2px var(--ember);
}
.prog { margin-bottom: 12px; }
.prog-row { display: flex; justify-content: space-between; gap: 10px; font-size: 15px; font-weight: 700; margin-bottom: 6px; }
.track { height: 8px; border-radius: 99px; background: rgba(255, 245, 228, 0.45); overflow: hidden; }
.fill { height: 100%; border-radius: 99px; background: var(--linen); transition: width 0.4s ease; }

/* ---------- Card ---------- */
.board-grid {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; padding: 7px;
  background: var(--papaya); border-radius: 18px;
  box-shadow: 0 5px 0 rgba(142, 26, 14, 0.35), inset 0 0 0 2px rgba(142, 26, 14, 0.18);
}
.tile {
  aspect-ratio: 1 / 1.18; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 3px;
  padding: 5px 3px 4px; border: 0; border-radius: 8px; text-align: center; color: inherit; cursor: pointer;
}
.tile:active { transform: scale(0.97); }
.tile:focus-visible { outline: 3px solid #fff; outline-offset: 1px; }
.tile-label {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: clamp(10px, 2.9vw, 12.5px); font-weight: 700; line-height: 1.1;
  text-wrap: balance; hyphens: auto; overflow-wrap: anywhere;
}
.tile-sign {
  display: block; height: 1.3em; padding: 0 1px 1px; border-bottom: 2px solid;
  font-family: var(--hand); font-size: clamp(15px, 4.4vw, 19px); font-weight: 700; line-height: 1.2;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tile.red { background: var(--ember); color: #fff; }
.tile.red .tile-sign { border-color: rgba(255, 245, 228, 0.8); }
.tile.gold { background: var(--marigold); color: var(--ember-deep); }
.tile.gold .tile-sign { border-color: rgba(61, 15, 8, 0.65); }
.tile.signed { background: var(--linen); color: rgba(61, 15, 8, 0.55); }
.tile.signed .tile-sign { color: var(--pen); border-color: rgba(31, 63, 166, 0.45); }
.tile.signed .tile-label { font-weight: 600; }
.tile.win {
  background: radial-gradient(circle at 50% 30%, #fff0b3, #f4b43a); color: var(--ember-deep);
  box-shadow: inset 0 0 0 2px var(--ember);
}
.tile.win .tile-sign { color: var(--pen); border-color: rgba(31, 63, 166, 0.55); }
.tile.free { background: var(--ember); justify-content: center; align-items: center; padding: 3px; cursor: default; }
.tile.free:active { transform: none; }
.tile.free img { width: 100%; height: 100%; object-fit: contain; }
.free-text { font-weight: 800; font-size: 13px; color: var(--linen); }
.tile-sign.writing { animation: write 0.7s cubic-bezier(0.3, 0.7, 0.2, 1) both; }

/* ---------- Leaderboard ---------- */
.panel { background: var(--linen); border-radius: 22px; padding: 18px 16px; box-shadow: 0 5px 0 rgba(142, 26, 14, 0.35); }
.requests {
  margin-bottom: 12px; padding: 16px; border-radius: 18px; background: var(--linen);
  box-shadow: 0 5px 0 rgba(142, 26, 14, 0.35);
}
.requests h2 { margin: 0 0 10px; font-size: 18px; font-weight: 800; }
.request-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.request { padding: 12px; border-radius: 12px; background: #fff; }
.request p { margin: 0; font-size: 15px; }
.request-prompt { margin-top: 4px !important; color: var(--ember); font-weight: 700; }
.request-actions { display: flex; gap: 8px; margin-top: 12px; }
.request-actions .btn { flex: 1; padding: 11px 8px; font-size: 15px; }
.notice {
  margin: 0 0 12px; padding: 10px 12px; border-radius: 12px; background: #e4f2d7;
  color: #244616; font-weight: 700; font-size: 14px;
}
.card-refresh-error { margin-bottom: 12px; }
.card-refresh-error .btn { margin-top: 8px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat b { display: block; font-size: 32px; font-weight: 800; line-height: 1; color: var(--ember); font-variant-numeric: tabular-nums; }
.stat span { font-size: 14px; font-weight: 500; }
.panel h2 { margin: 22px 0 8px; font-size: 18px; font-weight: 800; }
.rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rank li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 12px; background: #fff; }
.rank li.me { background: #ffe7a6; box-shadow: inset 0 0 0 2px var(--marigold); }
.pos {
  flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  font-weight: 800; background: #f4e3c6; color: var(--ember);
}
.rank li:first-child .pos, .pos.p0 { background: var(--marigold); color: var(--ember-deep); }
.pos.p1 { background: #d9d4cc; color: var(--ember-deep); }
.pos.p2 { background: #e0aa6a; color: var(--ember-deep); }
.info { flex: 1; min-width: 0; }
.line { display: flex; align-items: baseline; gap: 8px; }
.nm { min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.you { flex: none; padding: 1px 8px; border-radius: 99px; background: var(--marigold); color: var(--ember-deep); font-size: 12px; font-weight: 800; }
.val { flex: none; margin-left: auto; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.meter { height: 6px; margin-top: 6px; border-radius: 99px; background: #f0dcc0; overflow: hidden; }
.meter i { display: block; height: 100%; border-radius: 99px; background: var(--papaya); }
.empty { margin: 0; font-size: 15px; font-weight: 500; }
.note { margin: 18px 0 0; font-size: 13px; opacity: 0.75; }
.retry { margin-top: 10px; }

/* ---------- Bottom navigation ---------- */
.dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; background: var(--linen);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom)); box-shadow: 0 -2px 0 rgba(142, 26, 14, 0.2);
}
.dock-inner { display: flex; gap: 8px; max-width: 480px; margin: 0 auto; }
.dock-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 6px;
  border: 0; border-radius: 14px; background: transparent; color: rgba(61, 15, 8, 0.65);
  font-size: 13px; font-weight: 700; cursor: pointer;
}
.dock-btn.on { background: rgba(237, 166, 35, 0.32); color: var(--ember); }

/* ---------- Sheets ---------- */
.scrim {
  position: fixed; inset: 0; z-index: 30; display: flex; align-items: flex-end; justify-content: center;
  background: rgba(61, 15, 8, 0.55); animation: fade 0.2s ease-out;
}
.sheet {
  position: relative; width: 100%; max-width: 480px; background: var(--linen);
  border-radius: 26px 26px 0 0; padding: 12px 18px calc(20px + env(safe-area-inset-bottom));
  animation: slide 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.grabber { width: 44px; height: 5px; margin: 0 auto 14px; border-radius: 9px; background: rgba(142, 26, 14, 0.25); }
.close {
  position: absolute; top: 12px; right: 12px; width: 42px; height: 42px; border: 0; border-radius: 50%;
  background: transparent; color: var(--ember); font-size: 30px; line-height: 1; cursor: pointer;
}
.prompt { margin: 4px 40px 16px 0; font-size: 24px; line-height: 1.15; font-weight: 800; color: var(--ember); text-wrap: balance; }
.signed-by { margin: 0 0 16px; font-size: 17px; }
.ink { font-family: var(--hand); font-size: 32px; font-weight: 700; color: var(--pen); }
.code-plate {
  margin: 0 0 18px; padding: 20px 8px; border-radius: 18px; text-align: center; background: var(--ember); color: var(--linen);
  font-size: clamp(64px, 22vw, 92px); font-weight: 800; line-height: 1; letter-spacing: 0.12em; text-indent: 0.12em;
}

/* ---------- Bingo moment ---------- */
.burst {
  position: fixed; inset: 0; z-index: 40; overflow: hidden; padding: 24px; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px;
  background: linear-gradient(180deg, #f2705a, #f58a47 55%, #f5a944); animation: fade 0.25s ease-out;
}
.sunwrap { position: relative; width: min(62vw, 250px); aspect-ratio: 1; }
.rays {
  position: absolute; left: 50%; top: 50%; width: 220vmax; height: 220vmax; transform: translate(-50%, -50%);
  background: repeating-conic-gradient(rgba(255, 240, 190, 0.38) 0 6deg, transparent 6deg 12deg);
  -webkit-mask-image: radial-gradient(circle closest-side, #000, transparent);
  mask-image: radial-gradient(circle closest-side, #000, transparent);
}
.sun {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, #fff3c4, #f7bb3d 58%, #ee9a1e);
  box-shadow: 0 0 90px 24px rgba(255, 214, 107, 0.65); animation: rise 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.burst-copy { position: relative; }
.burst-title { margin: 0; font-size: clamp(60px, 19vw, 88px); font-weight: 800; line-height: 0.95; letter-spacing: -0.02em; color: var(--ember-deep); }
.burst-sub { margin: 10px 0 0; font-size: 20px; font-weight: 600; }
.burst .btn { position: relative; }

/* ---------- Motion ---------- */
@keyframes fade { from { opacity: 0; } }
@keyframes slide { from { transform: translateY(28px); opacity: 0; } }
@keyframes rise { from { transform: translateY(55%) scale(0.7); opacity: 0; } }
@keyframes write { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }

@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>