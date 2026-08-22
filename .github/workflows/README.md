# NFL Widget Feed (Broncos + AFC West, Bills + AFC East)

## 1. Create the repo

**On a computer:** create a new public repo, upload `fetch-feed.mjs`,
`.github/workflows/update-feed.yml`, and `logos/` (with your PNGs inside),
preserving the folder structure, then commit.

**On iPhone only (no laptop):**
1. GitHub app → **+** → **Create repository** (public — raw file URLs and
free GitHub Pages need a public repo unless you pay for private Pages).
2. Open **github.com in Safari** on the repo and tap **Request Desktop
Site** — the app itself can't upload multiple files or nested folders.
3. **Add file → Create new file**, type `.github/workflows/update-feed.yml`
as the filename (the slashes auto-create the folders), paste in that
file's contents, commit. Repeat for `fetch-feed.mjs` and `README.md` at
the repo root.
4. For logos: **Add file → Create new file**, name it `logos/.gitkeep`,
commit (this creates the folder). Navigate into `logos/`, then **Add
file → Upload files** and drag/select your PNGs.
- If you have the project as a zip: unzip it first in the **Files app**
(tap the zip), then drag from the unzipped folder.

Either way — once everything's committed, the Action runs automatically
every ~15 min, or trigger it right away: repo → **Actions** tab → "Update
NFL feed" → **Run workflow** (this button works fine in the GitHub app
too). After the first run, `nfl-feed.json` appears in the repo root.

## 2. Add your custom logos
You want custom logos for **every NFL team**, not just your 8 tracked
ones — makes sense, since an opponent each week could be any of the 32.
Drop 32 PNGs into `/logos`, lowercase by abbreviation, matching ESPN's
standard abbreviations:

```
buf mia ne nyj (AFC East)
bal cin cle pit (AFC North)
hou ind jax ten (AFC South)
den kc lac lv (AFC West)
dal nyg phi wsh (NFC East)
chi det gb min (NFC North)
atl car no tb (NFC South)
ari lar sf sea (NFC West)
```
e.g. `den.png`, `kc.png`, `dal.png`.

Reachable at:
```
https://raw.githubusercontent.com/<your-username>/<repo>/main/logos/den.png
```

**Important:** open `fetch-feed.mjs` and set `LOGO_BASE_URL` near the top
to your actual repo path (e.g. `https://raw.githubusercontent.com/<you>/<repo>/main/logos`).
This is how the feed builds every logo URL below — it won't work with the
placeholder left in the file.

The feed always uses your custom logo — for the tracked team AND whichever
opponent shows up — via `team_logo` / `opponent_logo` / `home_logo` /
`away_logo`. If you haven't gotten to a particular team's logo yet, that
image element in Widgy will just show blank/broken until you add it —
nothing else in the feed depends on it.

## 3. Feed URL
```
https://raw.githubusercontent.com/<your-username>/<repo>/main/nfl-feed.json
```

## 4. What each team's entry looks like
Every team (in `teams.<ABBR>`) always has exactly one of three `mode`s.

**Upcoming (before kickoff):**
```json
{
"mode": "upcoming",
"division": "AFC West",
"name": "Denver Broncos",
"team_logo": "https://raw.githubusercontent.com/you/repo/main/logos/den.png",
"record": "6-2",
"standing": "1st in AFC West",
"conference_seed": 2,
"division_rank": 1,
"division_record": "4-1",
"opponent": "KC",
"opponent_name": "Kansas City Chiefs",
"opponent_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"home_logo": "https://raw.githubusercontent.com/you/repo/main/logos/den.png",
"away_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"home_away": "home",
"kickoff": "2026-09-21T20:25Z",
"kickoff_display": "Sun, Sep 21, 4:25 PM EDT",
"display": "vs KC — Sun, Sep 21, 4:25 PM EDT"
}
```

**Live (game in progress):**
```json
{
"mode": "live",
"opponent_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"home_logo": "https://raw.githubusercontent.com/you/repo/main/logos/den.png",
"away_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"team_score": 10,
"opp_score": 7,
"status_detail": "8:14 - 2nd",
"down_distance": "2nd & 6 at DEN 34",
"line_of_scrimmage": "DEN 34",
"last_play": "J. Allen pass complete to S. Diggs for 8 yards",
"display": "vs KC: 10-7 · 2nd & 6 at DEN 34"
}
```

**Final (until 10am Eastern the next day, then it flips back to "upcoming" for the next game):**
```json
{
"mode": "final",
"opponent_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"home_logo": "https://raw.githubusercontent.com/you/repo/main/logos/den.png",
"away_logo": "https://raw.githubusercontent.com/you/repo/main/logos/kc.png",
"team_score": 24,
"opp_score": 20,
"result": "W",
"display": "Final: 24-20 vs KC"
}
```

Every entry also carries `division`, `name`, `team_logo`, `record`,
`standing`, `conference_seed`, `division_rank`, and `division_record`
regardless of mode. `opponent_logo` / `home_logo` / `away_logo` are
present in all three modes except `"none"` (no game scheduled), where
there's no opponent yet.

## 5. The `divisions` block — for a self-sorting leaderboard
This is what makes "1st place at top, dynamically" possible. Widgy has no
way to sort JSON on its own, so the feed pre-sorts each division by
current standing before Widgy ever sees it:

```json
{
"divisions": {
"AFC West": [
{ "abbr": "KC", "division_rank": 1, "team_logo": "...", "display": "...", "record": "7-1" },
{ "abbr": "DEN", "division_rank": 2, "...": "..." },
{ "abbr": "LAC", "division_rank": 3, "...": "..." },
{ "abbr": "LV", "division_rank": 4, "...": "..." }
],
"AFC East": [ /* same shape, BUF/MIA/NE/NYJ in current order */ ]
}
}
```

Each entry in these arrays has every field from `teams.<ABBR>` above,
plus `abbr`. As standings change week to week, the objects in slots
`[0]`–`[3]` swap — slot `[0]` is always whoever's in 1st, regardless of
which team that is.

## 6. Build the widget in Widgy
**Leaderboard (order changes automatically):**
For each division, add 4 rows bound to fixed array slots:
- Row 1: `divisions["AFC West"][0].team_logo`, `divisions["AFC West"][0].name`, `divisions["AFC West"][0].record`
- Row 2: `divisions["AFC West"][1].team_logo`, `...[1].name`, `...[1].record`
- Row 3 / Row 4: same pattern with `[2]` / `[3]`
- Repeat for `divisions["AFC East"]` in a second column

(Some JSON-path implementations want bracket syntax for keys with spaces —
if `divisions["AFC West"][0].name` doesn't resolve in Widgy, try
`divisions.AFC West[0].name` or check Widgy's specific JSONPath docs.)

**Broncos / Bills detail panel (score, live situation, etc.):**
- Image elements bound to `teams.DEN.home_logo` / `teams.DEN.away_logo`
(switches automatically based on home/away and opponent)
- Text elements bound to:
- `teams.DEN.display` — one-line summary, works in all 3 modes
- `teams.DEN.mode` — to conditionally show a "down & distance" box only
during live games
- `teams.DEN.down_distance`, `teams.DEN.last_play` — live detail
- `teams.DEN.standing`, `teams.DEN.record` — record/standing line

Set Widgy's refresh interval to ~15 min to match the feed (iOS throttles
widget refreshes regardless, so going tighter won't help much).

## Notes / known rough edges
- Everything comes from ESPN's public, unofficial site API — no key, but
no guarantees either. If a field goes missing, `display` is the safest
fallback since it's pre-formatted server-side.
- `conference_seed` / `division_rank` come from ESPN's standings endpoint,
which is the least-documented part of this API. Values should be right,
but if a team's rank looks off, open the feed's raw `nfl-feed.json` and
compare against espn.com/nfl/standings — the field names in that one
section are the most likely thing to need a tweak.
- The final-score cutoff is 10:00 AM **Eastern**, hardcoded via
`TIME_ZONE = "America/New_York"` at the top of `fetch-feed.mjs`.
- If you'd rather not have public raw URLs, GitHub Pages works the same
way and looks a bit cleaner: enable Pages in repo Settings (source:
`main` branch, root), then use `https://<user>.github.io/<repo>/nfl-feed.json`.
On iPhone, the Settings → Pages page is also only reachable via
desktop-site Safari, not the GitHub app.
