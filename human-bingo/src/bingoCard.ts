export const FREE_SQUARE = 12

// 5×5 board, left to right, top to bottom.
// `prompt` is shown when a square is tapped; `label` is the short text on the grid.
// Index 12 is the free CNAHS square, so its text is unused.
export const SQUARES: { prompt: string; label: string }[] = [
    { prompt: 'Find someone from a different year level', label: 'Different year level' },
    { prompt: 'Find someone who knows what CNAHS stands for', label: 'Knows what CNAHS means' },
    { prompt: 'Find someone who has the same favorite color as you', label: 'Same favorite color' },
    { prompt: 'Find someone who has a pet', label: 'Has a pet' },
    { prompt: 'Find someone who loves watching movies', label: 'Loves watching movies' },

    { prompt: 'Find someone who has already experienced clinical duty', label: 'Has done clinical duty' },
    { prompt: 'Find someone who knows a medical term', label: 'Knows a medical term' },
    { prompt: 'Find someone who loves coffee', label: 'Loves coffee' },
    { prompt: 'Find someone who has the same birth month as you', label: 'Same birth month' },
    { prompt: 'Find someone who loves K-pop', label: 'Loves K-pop' },

    { prompt: 'Find someone wearing the same color as you', label: 'Wearing the same color' },
    { prompt: 'Find someone who can give a fun fact about their program', label: 'Fun fact about program' },
    { prompt: '', label: '' }, // 12: free square
    { prompt: 'Find someone who can dance', label: 'Can dance' },
    { prompt: 'Find someone who has a dream travel destination', label: 'Has a dream trip' },

    { prompt: 'Find someone with the same birth month as you', label: 'Same birth month' },
    { prompt: 'Find someone who wants to work abroad someday', label: 'Wants to work abroad' },
    { prompt: 'Find someone who has the same favorite food as you', label: 'Same favorite food' },
    { prompt: 'Find someone who lives outside Cebu City', label: 'Lives outside Cebu City' },
    { prompt: 'Find someone who plays a sport', label: 'Plays a sport' },

    { prompt: 'Find someone from a different section', label: 'Different section' },
    { prompt: 'Find someone who has a friend from another program', label: 'Friend in another program' },
    { prompt: 'Find someone who can speak 3 languages', label: 'Speaks 3 languages' },
    { prompt: 'Find someone who has traveled recently', label: 'Traveled recently' },
    { prompt: 'Find someone who loves matcha', label: 'Loves matcha' },
]