# Edge — betting discipline dashboard

A static, mobile-first dashboard for tracking a set-aside sports betting bankroll (NFL, college football, UFC on DraftKings / FanDuel). Discipline first: flat units, a 2% stake cap, daily/weekly loss limits with a STOP state, and chasing flags.

**Live:** https://rfunes92.github.io/edge-betting/

## Privacy
There is no backend. Bets, settings, line-shop rows, the watchlist and the weekly checklist are stored **only in the browser's localStorage** on the device you use. Nothing personal is committed to this repo. Use *Settings → Data → Export JSON* for backups.

## Files
| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `assets/styles.css` | Styles (matte black / cyan) |
| `assets/app.js` | All logic (no build step) |
| `picks.json` | Top Picks content — edit this to update picks without touching code |

Chart.js (v4, jsDelivr CDN) and Inter (Google Fonts) are the only external resources.

## Sections
- **Home** — Top Picks, Guardrails (today / this week Mon–Sun ET vs limits, STOP banner, chasing flags), Stats (bankroll, P/L, record, win rate, ROI, avg CLV, profit by sport and bet type, bankroll chart).
- **Bet log** — add / edit / delete, one-tap settle, warning when stake > 2% of current bankroll.
- **Line Shop** — DK vs FD price comparison: best book, implied probability, no-vig fair price (when both sides are entered), difference in cents, EV of the best price vs fair; rows can be sent to the bet log.
- **Tracker** — manual injury / practice / weigh-in / line-move watchlist with sport filters.
- **Weekly Rhythm** — checklist that highlights today's tasks (ET) and resets every Monday.
- **Sources** — research sites (free vs paid) and X accounts.
- **Settings** — starting bankroll, unit size (1–2%), loss limits, CSV/JSON export & import.

## `picks.json` schema

```jsonc
{
  "updated": "2026-10-24T09:30:00-04:00", // ISO 8601 with offset; shown as "Updated … ET"
  "note": "Optional message shown above the picks (or when there are none).",
  "pass": false,                           // true = slate is weak; shows a "Pass" card
  "passNote": "Nothing clears the bar this week. Passing is a position.",
  "picks": [
    {
      "id": "2026-w8-1",                   // any unique string
      "sport": "NFL",                      // "NFL" | "College Football" | "UFC" | "Other"
      "event": "Team A @ Team B",
      "start": "2026-10-25T13:00:00-04:00",// ISO 8601; displayed in America/New_York
      "market": "spread",                  // moneyline | spread | total | prop | parlay | other
      "selection": "Team B -2.5",
      "book": "DraftKings",                // book with the best odds seen: "DraftKings" | "FanDuel"
      "odds": -108,                        // best American odds seen at that book
      "confidence": "Medium",              // "Low" | "Medium" | "High" only
      "units": 1,                          // suggested units; $ = units × unit size, capped at 2% of bankroll
      "reasoning": ["Short bullet", "Short bullet"],
      "risks": ["Key risk", "Key risk"]
    }
  ]
}
```

Rules for picks content:
- Confidence is only **Low**, **Medium** or **High**. Never use "lock" or any guarantee language.
- Keep `units` small (0.5–2). The app caps the dollar stake at 2% of the current bankroll regardless.
- If the STOP banner is active (a loss limit was hit), picks are greyed out and can't be logged.
- Break-even reminder: at -110 a bettor must win ~52.4% just to break even. No pick is guaranteed; the house has an edge.

## Bet export columns (CSV)
`id,date,book,sport,market,pick,odds,stake,closing,result,createdAt,settledAt` — `date` is `YYYY-MM-DD`, odds are American, `result` is `pending|win|loss|push|void`, timestamps are epoch ms. JSON export is `{ app, version, exportedAt, settings, bets }`.

## Math
- Profit on a win: `stake × (decimal − 1)`; loss: `−stake`; push/void: 0.
- ROI = profit ÷ amount staked on graded (non-void) bets.
- CLV = implied prob(closing odds) − implied prob(odds taken), averaged; positive = you beat the close.
- No-vig fair probability = `p_side ÷ (p_side + p_other)` per book, averaged across books with both sides entered.

---
Betting money stays separate from bills, savings, and business money. If gambling stops being fun: 1-800-GAMBLER.
