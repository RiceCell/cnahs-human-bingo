export const FREE_SQUARE = 12

// 5×5 board, left to right, top to bottom.
// Index 12 is the free CNAHS square, so its text is unused.
export const CARD: string[] = [
    'Find someone from a different year level',
    'Find someone who knows what CNAHS stands for',
    'Find someone who has the same favorite color as you',
    'Find someone who has a pet',
    'Find someone who loves watching movies',

    'Find someone who has already experienced clinical duty',
    'Find someone who knows a medical term',
    'Find someone who loves coffee',
    'Find someone who has the same birth month as you',
    'Find someone who loves K-pop',

    'Find someone wearing the same color as you',
    'Find someone who can give a fun fact about their program',
    '', // 12: free square
    'Find someone who can dance',
    'Find someone who has a dream travel destination',

    'Find someone with the same birth month as you',
    'Find someone who wants to work abroad someday',
    'Find someone who has the same favorite food as you',
    'Find someone who lives outside Cebu City',
    'Find someone who plays a sport',

    'Find someone from a different section',
    'Find someone who has a friend from another program',
    'Find someone who can speak 3 languages',
    'Find someone who has traveled recently',
    'Find someone who loves matcha',
]

// "Find someone who has a pet" -> "Someone who has a pet" (shorter text for the small grid cells)
export function shortText(text: string): string {
    const t = text.replace(/^find\s+/i, '')
    return t.charAt(0).toUpperCase() + t.slice(1)
}