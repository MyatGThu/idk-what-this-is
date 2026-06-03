// ─── CONFIG — fill in after deploying your Worker ───────────────
// Run:  wrangler d1 create poker-live-tracker
//       wrangler deploy
// Then replace the URL below with your Worker's URL.
const API_BASE = 'https://poker-live-api.goodgaminggm.workers.dev/api';

const CURRENCY = '$';

// Flat tournament entry fee pre-filled per player when a structure is chosen.
// APL chips have no cash value — this is just the (optional) entry fee. Editable
// per player in the picker; defaults to 10 if omitted.
const ENTRY_FEE = 10;

// Pre-seed the player roster (optional — players can also be added in-app)
const DEFAULT_ROSTER = [];
