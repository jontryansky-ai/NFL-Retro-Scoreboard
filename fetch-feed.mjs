// fetch-feed.mjs
// Builds nfl-feed.json for the Broncos (AFC West) and Bills (AFC East).
//
// Per team, picks ONE of three modes based on game state + time:
//   "upcoming" - next scheduled game hasn't started: date/time, opponent,
//                record, division rank, conference seed
//   "live"     - game in progress: score, down & distance, yard line,
//                possession, last play
//   "final"    - most recent game ended less than CUTOFF_HOUR (local time,
//                next day) ago: final score. After the cutoff, falls back
//                to "upcoming" for the next game.
//
// Data source: ESPN's public, unofficial site API (no key required).
// Unofficial = can change without notice; this is written defensively
// (try/catch per team, optional chaining everywhere) so one bad response
// doesn't take down the whole feed.

import { writeFile } from "node:fs/promises";

const TIME_ZONE = "America/New_York"; // Eastern — change if you want a different cutoff zone
const CUTOFF_HOUR = 10; // final score shows until 10:00 local the day after the game

// TODO: set this to where your custom logos actually live, e.g.
// "https://raw.githubusercontent.com/<you>/<repo>/main/logos"
// or "https://<you>.github.io/<repo>/logos" if using Pages.
const LOGO_BASE_URL = "https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/logos";

function customLogoUrl(abbr) {
  return `${LOGO_BASE_URL}/${abbr.toLowerCase()}.png`;
}

const TEAMS = {
  DEN: { id: 7, division: "AFC West" },
  KC: { id: 12, division: "AFC West" },
  LAC: { id: 24, division: "AFC West" },
  LV: { id: 13, division: "AFC West" },
  BUF: { id: 2, division: "AFC East" },
  MIA: { id: 15, division: "AFC East" },
  NE: { id: 17, division: "AFC East" },
  NYJ: { id: 20, division: "AFC East" },
};
// NOTE: these are ESPN's standard team IDs. If a team's data looks wrong,
// double check its id against https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams

const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const STANDINGS_URL =
  "https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?level=3";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ESPN's schedule endpoint returns score as an object like
// { value: 24, displayValue: "24" } instead of a plain number the way the
// scoreboard endpoint does. Number(thatObject) silently becomes NaN (which
// then serializes to null in JSON) — this handles both shapes correctly.
function extractScore(scoreField) {
  if (scoreField == null) return null;
  if (typeof scoreField === "object") {
    const raw = scoreField.value ?? scoreField.displayValue;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(scoreField);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

// ---- timezone helpers (no library, just Intl) ----

function getUtcOffsetHours(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = tz.match(/GMT([+-]\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function getLocalYMD(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { year: +parts.year, month: +parts.month, day: +parts.day };
}

// Returns the UTC instant of CUTOFF_HOUR local time on the day AFTER gameEndUtc
function cutoffAfterGame(gameEndUtc) {
  const { year, month, day } = getLocalYMD(gameEndUtc, TIME_ZONE);
  const offset = getUtcOffsetHours(gameEndUtc, TIME_ZONE);
  return new Date(Date.UTC(year, month - 1, day + 1, CUTOFF_HOUR - offset, 0, 0));
}

// ---- standings (best-effort; ESPN's tree structure here is the least stable part of this API) ----

async function buildStandingsIndex() {
  // Maps team abbreviation -> { divisionRank, divisionRecord, conferenceSeed }
  const index = {};
  try {
    const data = await getJson(STANDINGS_URL);

    function walk(node) {
      const entries = node?.standings?.entries;
      if (Array.isArray(entries)) {
        const isLeafDivision = !node.children || node.children.length === 0;
        entries.forEach((entry, i) => {
          const abbr = entry?.team?.abbreviation;
          if (!abbr) return;
          const stat = (name) =>
            entry.stats?.find((s) => s.name === name || s.type === name)
              ?.displayValue ?? null;

          index[abbr] = index[abbr] || {};
          if (isLeafDivision) {
            index[abbr].divisionRank = i + 1;
            const w = stat("wins") ?? "?";
            const l = stat("losses") ?? "?";
            const t = stat("ties");
            index[abbr].divisionRecord = t && t !== "0" ? `${w}-${l}-${t}` : `${w}-${l}`;
          } else {
            index[abbr].conferenceSeed = i + 1;
          }
        });
      }
      for (const child of node?.children ?? []) walk(child);
    }
    walk(data);
  } catch (err) {
    console.error("Standings fetch failed, continuing without it:", err.message);
  }
  return index;
}

// ---- per-team game state ----

async function getTeamMeta(id) {
  const data = await getJson(`${BASE}/teams/${id}`);
  const team = data.team;
  return {
    name: team?.displayName ?? null, // e.g. "Denver Broncos"
    standingSummary: team?.standingSummary ?? null, // e.g. "1st in AFC West"
    recordSummary: team?.record?.items?.[0]?.summary ?? null, // e.g. "6-2"
  };
}

async function getTeamSchedule(id) {
  const data = await getJson(`${BASE}/teams/${id}/schedule`);
  return data.events ?? [];
}

async function getLiveSituation(eventId) {
  const data = await getJson(`${BASE}/summary?event=${eventId}`);
  const comp = data?.header?.competitions?.[0];
  const situation = comp?.situation;
  const lastPlay = situation?.lastPlay?.text ?? null;
  return {
    downDistance: situation?.shortDownDistanceText ?? situation?.downDistanceText ?? null,
    yardLine: situation?.possessionText ?? null, // e.g. "DEN 34"
    possession: situation?.possession ?? null, // team id with the ball
    lastPlay,
  };
}

function formatKickoff(dateIso) {
  const d = new Date(dateIso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

async function buildTeamEntry(abbr, config, standingsIndex) {
  const now = new Date();
  const [meta, events] = await Promise.all([
    getTeamMeta(config.id),
    getTeamSchedule(config.id),
  ]);

  const withState = events.map((e) => ({
    id: e.id,
    date: e.date,
    state: e.competitions?.[0]?.status?.type?.state, // "pre" | "in" | "post"
    detail: e.competitions?.[0]?.status?.type?.shortDetail,
    competitors: e.competitions?.[0]?.competitors ?? [],
  }));

  const self = (ev) =>
    ev.competitors.find((c) => c.team?.abbreviation === abbr);
  const opp = (ev) => ev.competitors.find((c) => c.team?.abbreviation !== abbr);

  const liveEvent = withState.find((e) => e.state === "in");
  const pastFinals = withState
    .filter((e) => e.state === "post" && new Date(e.date) <= now)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const lastFinal = pastFinals[0];
  const nextUpcoming = withState
    .filter((e) => e.state === "pre" && new Date(e.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0];

  const base = {
    division: config.division,
    name: meta.name,
    team_logo: customLogoUrl(abbr), // your custom logo, always present
    record: meta.recordSummary,
    standing: meta.standingSummary,
    conference_seed: standingsIndex[abbr]?.conferenceSeed ?? null,
    division_rank: standingsIndex[abbr]?.divisionRank ?? null,
    division_record: standingsIndex[abbr]?.divisionRecord ?? null,
  };

  if (liveEvent) {
    const situation = await getLiveSituation(liveEvent.id).catch(() => ({}));
    const me = self(liveEvent);
    const other = opp(liveEvent);
    const opponentLogo = other?.team?.abbreviation ? customLogoUrl(other.team.abbreviation) : null; // your custom logo for whichever team shows up
    const isHome = me?.homeAway === "home";
    const teamScore = extractScore(me?.score) ?? 0;
    const oppScore = extractScore(other?.score) ?? 0;
    return {
      ...base,
      mode: "live",
      opponent: other?.team?.abbreviation ?? null,
      opponent_name: other?.team?.displayName ?? null,
      opponent_logo: opponentLogo,
      home_logo: isHome ? base.team_logo : opponentLogo,
      away_logo: isHome ? opponentLogo : base.team_logo,
      home_away: me?.homeAway ?? null,
      team_score: teamScore,
      opp_score: oppScore,
      status_detail: liveEvent.detail,
      down_distance: situation.downDistance,
      line_of_scrimmage: situation.yardLine,
      last_play: situation.lastPlay,
      display: `vs ${other?.team?.abbreviation ?? "?"}: ${teamScore}-${oppScore} · ${situation.downDistance ?? liveEvent.detail}`,
    };
  }

  if (lastFinal && now < cutoffAfterGame(new Date(lastFinal.date))) {
    const me = self(lastFinal);
    const other = opp(lastFinal);
    const opponentLogo = other?.team?.abbreviation ? customLogoUrl(other.team.abbreviation) : null;
    const isHome = me?.homeAway === "home";
    const teamScore = extractScore(me?.score);
    const oppScore = extractScore(other?.score);
    return {
      ...base,
      mode: "final",
      opponent: other?.team?.abbreviation ?? null,
      opponent_name: other?.team?.displayName ?? null,
      opponent_logo: opponentLogo,
      home_logo: isHome ? base.team_logo : opponentLogo,
      away_logo: isHome ? opponentLogo : base.team_logo,
      home_away: me?.homeAway ?? null,
      team_score: teamScore,
      opp_score: oppScore,
      result:
        teamScore == null || oppScore == null
          ? null
          : teamScore > oppScore
          ? "W"
          : teamScore < oppScore
          ? "L"
          : "T",
      display: `Final: ${teamScore ?? "?"}-${oppScore ?? "?"} vs ${other?.team?.abbreviation ?? "?"}`,
    };
  }

  if (nextUpcoming) {
    const other = opp(nextUpcoming);
    const me = self(nextUpcoming);
    const opponentLogo = other?.team?.abbreviation ? customLogoUrl(other.team.abbreviation) : null;
    const isHome = me?.homeAway === "home";
    return {
      ...base,
      mode: "upcoming",
      opponent: other?.team?.abbreviation ?? null,
      opponent_name: other?.team?.displayName ?? null,
      opponent_logo: opponentLogo,
      home_logo: isHome ? base.team_logo : opponentLogo,
      away_logo: isHome ? opponentLogo : base.team_logo,
      home_away: me?.homeAway ?? null,
      kickoff: nextUpcoming.date,
      kickoff_display: formatKickoff(nextUpcoming.date),
      display: `${me?.homeAway === "home" ? "vs" : "@"} ${other?.team?.abbreviation ?? "?"} — ${formatKickoff(nextUpcoming.date)}`,
    };
  }

  return { ...base, mode: "none", display: "No game scheduled" };
}

async function main() {
  const standingsIndex = await buildStandingsIndex();
  const teams = {};

  for (const [abbr, config] of Object.entries(TEAMS)) {
    try {
      teams[abbr] = await buildTeamEntry(abbr, config, standingsIndex);
    } catch (err) {
      console.error(`Failed to build entry for ${abbr}:`, err.message);
      teams[abbr] = { division: config.division, mode: "error", display: "Data unavailable" };
    }
    await sleep(200); // be polite to an unofficial API
  }

  // Group into divisions and sort leader (1) -> last (4). Widgy can't sort
  // JSON itself, so each division is pre-ordered here — bind a fixed slot
  // like divisions["AFC West"][0] and it'll always show whoever's in 1st.
  const divisions = {};
  for (const [abbr, config] of Object.entries(TEAMS)) {
    const list = (divisions[config.division] ??= []);
    list.push({ abbr, ...teams[abbr] });
  }
  for (const list of Object.values(divisions)) {
    list.sort((a, b) => (a.division_rank ?? 99) - (b.division_rank ?? 99));
  }

  const feed = { updated_at: new Date().toISOString(), teams, divisions };
  await writeFile("nfl-feed.json", JSON.stringify(feed, null, 2));
  console.log("Wrote nfl-feed.json for", Object.keys(teams).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
