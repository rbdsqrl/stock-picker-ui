import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import styles from "./History.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";
const RANK_LABEL = { 1: "#1", 2: "#2", 3: "#3" };

// Dates per page. Prices are only fetched for the page on screen, so this also caps
// how much of the rate-limit budget one visit to the History page can spend.
const DATES_PER_PAGE = 5;
// Symbols per /api/prices call. The backend spends one Yahoo chart request per symbol,
// so the page asks in small groups, one call after the next, rather than in one burst.
const PRICE_CHUNK = 5;

// How far back the change trail is read. Enough to cover a long absence without
// pulling the whole table's history on every visit.
const EVENT_LIMIT = 200;
// Mirrors SL_GRACE_DAYS / SL_GRACE_MULT in backend/database.py. Only used to label
// the derived "grace window closed" step in a call's trail — nothing is scored here.
const SL_GRACE_DAYS = 10;
const SL_GRACE_MULT = 2;

const SEEN_KEY = "history:seenAt";

// Rows the strip shows before it stops listing and offers the filter instead. A
// quiet week turns a handful of calls; a first scoring run can turn forty, and a
// strip that long stops being a summary and buries the table under itself.
const STRIP_MAX = 6;

// localStorage throws outright in some contexts (private windows, blocked site
// data), so every read and write is guarded — a missing marker just means
// nothing is flagged as new, which is the safe direction to fail.
function readSeen() {
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}
function writeSeen(iso) {
  try { localStorage.setItem(SEEN_KEY, iso); } catch { /* nothing to do */ }
}

// Each stat chip doubles as a filter over the table below, so the counts stay the
// way you drill into them. Predicates live here so the number on the chip and the
// rows it reveals can never drift apart.
const STAT_FILTERS = [
  { key: "total",   label: "Total calls", color: "var(--text)",   border: null,
    match: () => true },
  { key: "hits",    label: "Hits",       color: "var(--accent)", border: "rgba(74,222,128,0.3)",
    match: p => p.target_hit === 1 },
  { key: "misses",  label: "Misses",     color: "var(--red)",    border: "rgba(248,113,113,0.3)",
    match: p => p.target_hit === 0 },
  // Waiting means neither target has been touched yet — a call that already
  // tagged T1 is shown in its own chip instead, so the two never overlap.
  { key: "waiting", label: "Waiting",    color: "var(--yellow)", border: null,
    match: p => p.target_hit == null && p.target_short_hit !== 1 },
  // Open picks that already tagged the short target — the move is underway.
  { key: "t1",      label: "T1 in play", color: "var(--accent)", border: "rgba(74,222,128,0.3)",
    opacity: 0.72, match: p => p.target_hit == null && p.target_short_hit === 1 },
];

// How a call's standing reads once the three stored flags are collapsed into one
// state. Mirrors _outcome_state() in backend/database.py — the backend names the
// state, this only decides how to draw it.
const STATE_LABEL = {
  waiting: { text: "waiting", cls: "stPending" },
  t1:      { text: "◐ T1",    cls: "stT1" },
  t2:      { text: "✓ T2",    cls: "stHit" },
  sl:      { text: "✗ SL",    cls: "stFail" },
  t1_sl:   { text: "✓ T1 · SL",  cls: "stT1Won" },
  t1_exp:  { text: "✓ T1 · exp", cls: "stT1Won" },
  expired: { text: "✗ missed",   cls: "stFail" },
};

// What each recorded milestone means, and whether it went the pick's way. `tone`
// only drives the timeline pip — the wording carries the detail.
const EVENT_KIND = {
  t1_hit:  { what: "T1 tagged — move underway",   tone: "good" },
  t2_hit:  { what: "T2 hit — call resolved",      tone: "good" },
  sl_hit:  { what: "Stopped out",                 tone: "bad"  },
  expired: { what: "Expired at 45 days",          tone: "bad"  },
  cleared: { what: "Outcome cleared — back to open", tone: "open" },
};

// Which price on the deciding bar settled it. Targets are a high touch and the
// stop is judged on the close, so naming the one that did it says more than a
// bare date — and stays short enough not to wrap the column.
const DECIDED_BY = {
  t1_hit:  "high on",
  t2_hit:  "high on",
  sl_hit:  "close on",
  expired: "expired",
};

const SOURCE_LABEL = {
  scheduled:     "daily re-score",
  manual_refresh: "manual refresh",
  recalc_levels: "level recalculation",
  backfill:      "reconstructed from stored hit dates",
};

// Group by date, then by run inside it: re-running the screener on the same day no
// longer overwrites the earlier call, so a date can hold several sets of picks.
function groupByDate(rows) {
  const out = [];
  const seen = {};
  for (const p of rows) {
    const runKey = p.run_at || "";
    if (!seen[p.date]) {
      seen[p.date] = { runs: [], byRun: {} };
      out.push({ date: p.date, ...seen[p.date] });
    }
    const group = seen[p.date];
    if (!group.byRun[runKey]) {
      group.byRun[runKey] = { runAt: p.run_at, rows: [] };
      group.runs.push(group.byRun[runKey]);
    }
    group.byRun[runKey].rows.push(p);
  }
  return out;
}

// One line per pick from a list of events: what it was before the first change,
// what it is after the last. Events arrive newest-first, so the earliest entry
// for a pick is the one that carries the state it started from.
function summariseByPick(events) {
  const order = [];
  const byPick = {};
  for (const e of events) {
    if (!byPick[e.pick_id]) {
      byPick[e.pick_id] = { pick_id: e.pick_id, latest: e, earliest: e, kinds: [e.kind] };
      order.push(byPick[e.pick_id]);
    } else {
      // Still descending, so anything seen later in the list is older.
      byPick[e.pick_id].earliest = e;
      byPick[e.pick_id].kinds.push(e.kind);
    }
  }
  return order;
}

function fmt(v) {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function StatePill({ state, days }) {
  const s = STATE_LABEL[state] || STATE_LABEL.waiting;
  return (
    <span className={`${styles.statePill} ${styles[s.cls]}`}>
      {s.text}{days != null ? ` ${days}d` : ""}
    </span>
  );
}

function NowCell({ entry, now, label }) {
  if (now == null) return (
    <span className={styles.nowLive}>
      {label && <span className={styles.cellLabel}>{label}</span>}
      <span className={styles.cellMono}>—</span>
    </span>
  );
  const pct = ((now - entry) / entry * 100).toFixed(1);
  const up  = now >= entry;
  return (
    <span className={styles.nowLive}>
      {label && <span className={styles.cellLabel}>{label}</span>}
      <span className={styles.nowBadge}>
        <span className={styles.liveDot} />
        <span className={styles.cellMono}>{fmt(now)}</span>
      </span>
      <span className={up ? styles.chgUp : styles.chgDown}>{up ? "+" : ""}{pct}%</span>
    </span>
  );
}

function LevelCell({ price, pct, color, label }) {
  return (
    <span className={styles.levelCell}>
      {label && <span className={styles.cellLabel}>{label}</span>}
      <span className={styles.cellMono} style={{ color }}>{fmt(price)}</span>
      {pct != null && <span className={styles.pctNote}>{pct > 0 ? `+${pct}` : pct}%</span>}
    </span>
  );
}

function HitCell({ hit, slHit, days, date, slDate, slDays, currentPrice, target,
                   t1Hit, t1Date, t1Days }) {
  if (hit === 1) return (
    <span className={`${styles.hitYes} ${styles.hitCellWrap}`} title={date ? `T2 hit on ${date}` : undefined}>
      ✓ T2 {days != null ? `${days}d` : ""}
    </span>
  );
  // T1 is a high touch and the SL is judged on the close, so on any bar where both
  // register the T1 touch necessarily came first. A pick that reached T1 banked that
  // gain before it was stopped — that is a T1 hit, not a plain stop-out.
  if (slHit === 1 && t1Hit === 1) return (
    <span className={`${styles.hitT1Won} ${styles.hitCellWrap}`}
          title={`T1 hit on ${t1Date} — before the SL closed below on ${slDate}`}>
      ✓ T1 {t1Days != null ? `${t1Days}d` : ""} · SL
    </span>
  );
  if (hit === 0 && slHit === 1) return (
    <span className={`${styles.hitNo} ${styles.hitCellWrap}`} title={slDate ? `SL closed below on ${slDate}` : "Stopped out"}>
      ✗ SL {slDays != null ? `${slDays}d` : ""}
    </span>
  );
  // Expired at 45 days. T1 may still have been reached along the way.
  if (hit === 0 && t1Hit === 1) return (
    <span className={`${styles.hitT1Won} ${styles.hitCellWrap}`} title={`T1 hit on ${t1Date} — T2 never reached, expired at 45d`}>
      ✓ T1 {t1Days != null ? `${t1Days}d` : ""} · exp
    </span>
  );
  if (hit === 0) return <span className={`${styles.hitNo} ${styles.hitCellWrap}`}>✗ missed</span>;
  // Still open, but the short target is already in hand — the move is underway.
  if (t1Hit === 1) return (
    <span className={`${styles.hitT1} ${styles.hitCellWrap}`} title={t1Date ? `T1 reached on ${t1Date} — T2 still open` : undefined}>
      ◐ T1 {t1Days != null ? `${t1Days}d` : ""}
    </span>
  );
  if (currentPrice != null && target != null && currentPrice >= target)
    return <span className={`${styles.hitLive} ${styles.hitCellWrap}`} title="Live price at or above target — will confirm on next refresh">↑ live</span>;
  return <span className={`${styles.hitPending} ${styles.hitCellWrap}`}>—</span>;
}

// ── Change strip ────────────────────────────────────────────────────────────
// One row per call that turned: what it was, what it is now, the bar that decided
// it, and the move since entry. Rendered only when there is something to say.
function ChangeStrip({ title, subtitle, rows, picksById, prices, actions, onView, onShowAll }) {
  if (!rows.length) return null;
  const listed = rows.slice(0, STRIP_MAX);
  const rest   = rows.length - listed.length;
  return (
    <div className={styles.strip}>
      <div className={styles.stripHead}>
        <span className={styles.stripTitle}>{title}</span>
        {subtitle && <span className={styles.stripSince}>{subtitle}</span>}
        {actions && <span className={styles.stripActions}>{actions}</span>}
      </div>
      {listed.map(({ pick_id, latest, earliest }) => {
        const pick  = picksById[pick_id];
        const entry = pick?.price_at_pick ?? latest.price_at_pick;
        const now   = pick ? prices[pick.ticker] : null;
        const move  = entry != null && now != null ? ((now - entry) / entry * 100) : null;
        return (
          <div key={pick_id} className={styles.stripRow}>
            <span className={styles.stripTicker}>{latest.ticker}</span>
            <span className={styles.transition}>
              <StatePill state={earliest.from_state} />
              <span className={styles.stripArrow}>→</span>
              <StatePill state={latest.to_state} days={latest.days} />
            </span>
            <span className={styles.stripWhen}>
              {latest.event_date
                ? `${DECIDED_BY[latest.kind] || "on"} ${fmtDate(latest.event_date)}`
                : SOURCE_LABEL[latest.source] || "re-scored"}
            </span>
            <span className={styles.stripPx}>
              {move == null
                ? <span className={styles.stripMuted}>from {fmt(entry)}</span>
                : <><span className={move >= 0 ? styles.chgUp : styles.chgDown}>
                      {move >= 0 ? "+" : ""}{move.toFixed(1)}%
                    </span> from entry</>}
            </span>
            {onView && pick && (
              <button type="button" className={styles.stripView} onClick={() => onView(pick)}>
                View
              </button>
            )}
          </div>
        );
      })}
      {rest > 0 && (
        <div className={styles.stripMore}>
          <span>{rest} more {rest === 1 ? "call" : "calls"} turned.</span>
          {onShowAll && (
            <button type="button" className={styles.stripLink} onClick={onShowAll}>
              Show them all in the table
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Call trail ──────────────────────────────────────────────────────────────
// The life of one call. Two kinds of step share the timeline: market events dated
// by the bar that triggered them, and the scan that noticed — which is what
// explains a pick that resolved on Wednesday's bar and only turned green on Friday.
function CallTrail({ pick, events, loading, error }) {
  const entry = pick.price_at_pick;
  const stop  = pick.stop_loss;
  const graceStop = entry != null && stop != null
    ? entry - SL_GRACE_MULT * (entry - stop)
    : null;

  const picked = pick.date ? new Date(pick.date + "T00:00:00") : null;
  const graceEnd = picked
    ? new Date(picked.getTime() + SL_GRACE_DAYS * 86400000).toISOString().slice(0, 10)
    : null;
  // Derived, not stored: the same day-10 rule the backend already applies, shown
  // so the stop that was actually in force is visible rather than implied. A call
  // that was already resolved inside the window never reached it, so the step is
  // dropped rather than dated after the event that ended the call.
  const resolvedOn = events.find(e => e.kind !== "t1_hit" && e.event_date)?.event_date;
  const showGrace = graceEnd && graceStop != null &&
    (Date.now() - picked.getTime()) / 86400000 > SL_GRACE_DAYS &&
    !(resolvedOn && resolvedOn <= graceEnd);

  const steps = [];
  steps.push({
    key: "given", date: pick.date, days: 0, tone: "start",
    what: `Call given at #${pick.rank}`,
    why: [
      pick.score != null ? `score ${pick.score}` : null,
      stop != null ? `SL ${fmt(stop)}` : null,
      pick.target_short != null ? `T1 ${fmt(pick.target_short)}` : null,
      pick.target != null ? `T2 ${fmt(pick.target)}` : null,
    ].filter(Boolean).join(" · "),
    price: entry,
  });

  if (showGrace) steps.push({
    key: "grace", date: graceEnd, days: SL_GRACE_DAYS, tone: "open",
    what: "Grace window closed",
    why: `stop in force tightens from ${fmt(Math.round(graceStop * 100) / 100)} `
       + `(entry − ${SL_GRACE_MULT}R) to the stored ${fmt(stop)}`,
  });

  for (const e of events) {
    const kind = EVENT_KIND[e.kind] || { what: e.kind, tone: "open" };
    const why  = [];
    // Which stop was live is the day-10 rule again: inside the window a call is
    // only stopped by the doubled distance, so naming the level that actually
    // applied stops the line reading as a break of the stop shown in the table.
    if (e.price != null && e.kind === "sl_hit") {
      const inGrace = e.days != null && e.days <= SL_GRACE_DAYS;
      const level   = inGrace ? graceStop : stop;
      why.push(`close ${fmt(e.price)} fell below `
             + (level != null ? fmt(Math.round(level * 100) / 100) : "the stop")
             + (inGrace ? ` (the ${SL_GRACE_MULT}R grace stop, still inside day ${SL_GRACE_DAYS})` : ""));
    }
    else if (e.price != null && e.kind === "t1_hit") why.push(`daily high ${fmt(e.price)} crossed ${fmt(pick.target_short)}`);
    else if (e.price != null && e.kind === "t2_hit") why.push(`daily high ${fmt(e.price)} crossed ${fmt(pick.target)}`);
    else if (e.kind === "expired") why.push("neither the target nor the stop resolved it");
    else if (e.kind === "cleared") why.push("re-scored under the current rules");
    if (e.kind === "t1_hit") why.push("T2 still open at the time");
    // A backfilled row was reconstructed from stored dates, so it has no moment a
    // scan actually noticed it — claiming one would be inventing a timestamp.
    const stamped = e.noticed_at && e.source !== "backfill";
    why.push(`${STATE_LABEL[e.from_state]?.text ?? e.from_state} → ${STATE_LABEL[e.to_state]?.text ?? e.to_state}`
             + ` · ${SOURCE_LABEL[e.source] || e.source || "re-score"}`
             + `${stamped ? `, seen ${fmtStamp(e.noticed_at)}` : ""}`);
    steps.push({
      key: `e${e.id}`, date: e.event_date, noticed: e.noticed_at,
      days: e.days, tone: kind.tone,
      what: kind.what, why: why.join(" · "), price: e.price,
    });
  }

  // Same ordering rule as the API: by the bar that caused each step, falling back
  // to the day it was noticed for steps no bar produced.
  const at = s => s.date || (s.noticed || "9999-99-99").slice(0, 10);
  steps.sort((a, b) => at(a).localeCompare(at(b)));

  const pipClass = { start: "", good: styles.pipGood, bad: styles.pipBad, open: styles.pipOpen };

  return (
    <div className={styles.trail}>
      <div className={styles.trailHead}>
        Call trail · {pick.ticker} · picked {fmtDate(pick.date)}
      </div>
      {error && <div className={styles.trailError}>{error}</div>}
      {loading && !events.length && <div className={styles.trailNote}>Loading trail…</div>}
      <div className={styles.tl}>
        {steps.map(s => (
          <div key={s.key} className={styles.tlItem}>
            <span className={`${styles.tlPip} ${pipClass[s.tone] || ""}`} />
            <span className={styles.tlDate}>
              {s.date ? fmtDate(s.date) : (s.noticed ? fmtDate(s.noticed.slice(0, 10)) : "—")}
              {s.days != null ? ` · d${s.days}` : ""}
            </span>
            <span className={styles.tlBody}>
              <span className={styles.tlWhat}>{s.what}</span>
              {s.why && <span className={styles.tlWhy}>{s.why}</span>}
            </span>
            <span className={styles.tlPx}>{s.price != null ? fmt(s.price) : ""}</span>
          </div>
        ))}
      </div>
      {!loading && !events.length && (
        <div className={styles.trailNote}>
          Nothing has turned yet — this call is still open and the trail will fill in
          as T1, T2 or the stop resolve it.
        </div>
      )}
    </div>
  );
}

export default function History() {
  const [picks, setPicks]           = useState([]);
  const [prices, setPrices]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [statFilter, setStatFilter] = useState(null);
  const [page, setPage]             = useState(0);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [events, setEvents]         = useState([]);
  // On a first-ever visit the marker starts at now, so the whole back catalogue
  // is not reported as things that changed while you were away.
  const [seenAt, setSeenAt]         = useState(() => {
    const stored = readSeen();
    if (stored) return stored;
    const now = new Date().toISOString();
    writeSeen(now);
    return now;
  });
  const [expanded, setExpanded]     = useState(null);
  const [trails, setTrails]         = useState({});
  const [trailState, setTrailState] = useState({});

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/pick/history`)
      .then(r => r.json())
      .then(d => {
        setPicks(d.picks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const loadEvents = useCallback(() => {
    fetch(`${API}/api/pick/events?limit=${EVENT_LIMIT}`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .catch(() => { /* the strip simply stays hidden */ });
  }, []);

  const forceRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res  = await fetch(`${API}/api/pick/refresh-outcomes`, { method: "POST" });
      const data = await res.json();
      setRefreshResult(data);
    } catch (e) {
      setRefreshResult({ error: "Refresh failed — backend unreachable" });
    }
    load();
    loadEvents();
    setRefreshing(false);
  };

  useEffect(() => { load(); loadEvents(); }, [loadEvents]);

  // Everything recorded after the marker. The marker only moves on an explicit
  // "Mark all seen" — advancing it on load would mean a distracted glance at the
  // tab silently burns the whole list.
  // Compared as instants, not strings: the marker is written as "…Z" and the API
  // sends "…+00:00", and those two spellings of the same moment do not order
  // correctly under a lexicographic compare.
  const seenMs = useMemo(() => (seenAt ? new Date(seenAt).getTime() : 0), [seenAt]);
  const newEvents = useMemo(
    () => events.filter(e => e.noticed_at && new Date(e.noticed_at).getTime() > seenMs),
    [events, seenMs]);
  const changedIds = useMemo(() => new Set(newEvents.map(e => e.pick_id)), [newEvents]);
  const changedRows = useMemo(() => summariseByPick(newEvents), [newEvents]);

  const markAllSeen = () => {
    const now = new Date().toISOString();
    writeSeen(now);
    setSeenAt(now);
    setStatFilter(f => (f === "changed" ? null : f));
  };

  // The changed filter joins the same predicate-and-count contract as the rest, so
  // the number on the chip and the rows it reveals cannot drift apart.
  const filters = useMemo(() => (
    changedIds.size
      ? [...STAT_FILTERS, {
          key: "changed", label: "Changed", color: "var(--accent2)",
          border: "rgba(61,120,160,0.45)", isNew: true,
          match: p => changedIds.has(p.id),
        }]
      : STAT_FILTERS
  ), [changedIds]);

  const active    = filters.find(f => f.key === statFilter);
  const shown     = useMemo(
    () => (active ? picks.filter(active.match) : picks),
    [picks, active]);
  const allDates  = useMemo(() => groupByDate(shown), [shown]);
  const pageCount = Math.max(1, Math.ceil(allDates.length / DATES_PER_PAGE));
  // A filter can shrink the list under the current page — clamp rather than showing
  // an empty page the user never navigated to.
  const safePage  = Math.min(page, pageCount - 1);
  const byDate    = allDates.slice(safePage * DATES_PER_PAGE, (safePage + 1) * DATES_PER_PAGE);

  useEffect(() => { setPage(0); }, [statFilter]);

  const picksById = useMemo(() => Object.fromEntries(picks.map(p => [p.id, p])), [picks]);

  // Only the visible page's tickers are worth a price, and they are fetched in small
  // groups one after the other: the backend spends a Yahoo request per symbol, and
  // asking for all 90-odd at once is what got the whole list throttled down to a
  // couple of prices. Each group lands in state as it arrives, so the column fills in
  // progressively instead of waiting on the slowest call.
  const pageTickers = useMemo(
    () => [...new Set(byDate.flatMap(g => g.runs.flatMap(r => r.rows.map(p => p.ticker))))],
    [byDate]);
  const tickerKey = pageTickers.join(",");

  useEffect(() => {
    if (!pageTickers.length) return;
    let cancelled = false;

    (async () => {
      // Anything already in hand stays put — paging back to a seen date costs nothing.
      const missing = pageTickers.filter(t => prices[t] == null);
      if (!missing.length) { setPricesLoading(false); return; }
      setPricesLoading(true);
      for (let i = 0; i < missing.length; i += PRICE_CHUNK) {
        if (cancelled) return;
        const chunk = missing.slice(i, i + PRICE_CHUNK);
        try {
          // encodeURIComponent is load-bearing: M&MFIN's ampersand would otherwise end
          // the tickers parameter and every symbol after it would be silently dropped.
          const res  = await fetch(`${API}/api/prices?tickers=${encodeURIComponent(chunk.join(","))}`);
          const data = await res.json();
          if (cancelled) return;
          setPrices(prev => ({ ...prev, ...data }));
        } catch { /* network — leave those cells as — */ }
      }
      setPricesLoading(false);
    })();

    return () => { cancelled = true; };
  }, [tickerKey]);

  // A trail is fetched the first time its row is opened and then kept, so
  // collapsing and reopening a call costs nothing. Fetching is kept separate from
  // expanding: "View" needs the data without the toggle, and a toggle that also
  // fetched would close the row it was just asked to open.
  const fetchTrail = useCallback((pickId) => {
    if (trails[pickId] || trailState[pickId]?.loading) return;
    setTrailState(s => ({ ...s, [pickId]: { loading: true } }));
    fetch(`${API}/api/pick/events?pick_id=${pickId}`)
      .then(r => r.json())
      .then(d => {
        setTrails(t => ({ ...t, [pickId]: d.events || [] }));
        setTrailState(s => ({ ...s, [pickId]: { loading: false } }));
      })
      .catch(() => setTrailState(s => ({
        ...s, [pickId]: { loading: false, error: "Could not load this call's trail." },
      })));
  }, [trails, trailState]);

  const toggleTrail = useCallback((pick) => {
    setExpanded(cur => (cur === pick.id ? null : pick.id));
    fetchTrail(pick.id);
  }, [fetchTrail]);

  // "View" from a strip jumps to the call and opens it, which means clearing any
  // filter and paging to wherever that date landed.
  const viewPick = useCallback((pick) => {
    setStatFilter(null);
    const dates = groupByDate(picks).map(g => g.date);
    const idx   = dates.indexOf(pick.date);
    if (idx >= 0) setPage(Math.floor(idx / DATES_PER_PAGE));
    setExpanded(pick.id);
    fetchTrail(pick.id);
  }, [picks, fetchTrail]);

  if (loading) return <div className={styles.center}><div className={styles.spinner} /></div>;

  if (!picks.length) return (
    <div className={styles.center}>
      <div className={styles.emptyIcon}>◈</div>
      <p className={styles.emptyHead}>No history yet</p>
      <p className={styles.emptyBody}>Past picks will appear here. Run the screener from the Today tab first.</p>
    </div>
  );

  const top     = picks.filter(p => p.rank === 1 && p.target_hit != null);
  const hitRate = top.length > 0
    ? Math.round((top.filter(p => p.target_hit === 1).length / top.length) * 100)
    : null;

  const fmtLongDate = (iso) => new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const fmtRun = (iso) => {
    if (!iso) return "earlier run";
    const d = new Date(iso);
    return isNaN(d) ? "earlier run"
      : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  const refreshFailed = refreshResult &&
    (refreshResult.error || (refreshResult.failed && refreshResult.failed.length));
  const refreshRows = refreshResult?.events ? summariseByPick(refreshResult.events) : [];

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <div>
          <div className={styles.dateLabel}>TRACK RECORD</div>
          <div className={styles.headline}>Pick History</div>
        </div>
        <div className={styles.topRight}>
          {hitRate !== null && (
            <div className={styles.hitRate}>
              <span className={styles.hitNum} style={{ color: hitRate >= 55 ? "var(--accent)" : "var(--yellow)" }}>
                {hitRate}%
              </span>
              <span className={styles.hitLabel}>target hit rate · {top.length} resolved</span>
            </div>
          )}
          <button className={styles.refreshBtn} onClick={forceRefresh} disabled={refreshing}>
            {refreshing ? "Re-scoring..." : "↺ Refresh"}
          </button>
        </div>
      </div>

      <div className={styles.statsBar}>
        {filters.map(f => {
          const count = picks.filter(f.match).length;
          const on    = statFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              title={on ? `Showing ${f.label.toLowerCase()} only — click to clear` : `Show ${f.label.toLowerCase()} only`}
              className={`${styles.statChip} ${on ? styles.statChipOn : ""} ${f.isNew ? styles.statChipNew : ""}`}
              style={f.border ? { borderColor: f.border } : undefined}
              onClick={() => setStatFilter(on ? null : f.key)}
            >
              {f.isNew && <span className={styles.statChipDot} />}
              <span className={styles.statNum} style={{ color: f.color, opacity: f.opacity }}>{count}</span>
              <span className={styles.statLabel}>{f.label}</span>
            </button>
          );
        })}
        {active
          ? (
            <button type="button" className={styles.filterClear} onClick={() => setStatFilter(null)}>
              {shown.length} of {picks.length} shown · clear filter ✕
            </button>
          )
          : <span className={styles.statNote}>T1 (1× risk) confirms the move is underway; T2 (2× risk) resolves the pick. A miss is a close below the SL before T2, or 45 days with neither hit.</span>
        }
      </div>

      {/* A manual refresh reports on itself; the standing "since you last looked"
          strip waits until that banner is dismissed so the same news is not
          delivered twice. */}
      {refreshResult ? (
        <>
          <div className={refreshFailed ? styles.refreshError : styles.refreshOk}>
            {refreshResult.error
              ? refreshResult.error
              : `Re-resolved ${refreshResult.hits} hit(s), ${refreshResult.misses} miss(es), ${refreshResult.pending} still open (${refreshResult.t1_hits} reached T1) — ${refreshResult.hits_updated} outcome(s) changed.`}
            <button type="button" className={styles.bannerDismiss} onClick={() => setRefreshResult(null)}>
              Dismiss ✕
            </button>
          </div>
          <ChangeStrip
            title={`${refreshRows.length} call${refreshRows.length === 1 ? "" : "s"} turned in this run`}
            subtitle={`${refreshResult.hits} hits · ${refreshResult.misses} misses · ${refreshResult.pending} open`}
            rows={refreshRows}
            picksById={picksById}
            prices={prices}
            onView={viewPick}
            onShowAll={() => setStatFilter("changed")}
          />
          {refreshResult.failed?.length > 0 && (
            <div className={styles.refreshError}>
              Skipped — price fetch failed, outcome unchanged: {refreshResult.failed.join(", ")}
            </div>
          )}
        </>
      ) : (
        <ChangeStrip
          title={`${changedRows.length} call${changedRows.length === 1 ? "" : "s"} turned`}
          subtitle={seenAt ? `since ${fmtStamp(seenAt)}` : null}
          rows={changedRows}
          picksById={picksById}
          prices={prices}
          onView={viewPick}
          onShowAll={() => setStatFilter("changed")}
          actions={
            <>
              <button type="button" className={styles.stripLink}
                      onClick={() => setStatFilter(statFilter === "changed" ? null : "changed")}>
                {statFilter === "changed" ? "Show all" : "Show only these"}
              </button>
              <button type="button" className={styles.stripLinkPlain} onClick={markAllSeen}>
                Mark all seen
              </button>
            </>
          }
        />
      )}

      <div className={styles.tableWrap}>
        <div className={styles.tableHead}>
          <span>Rank</span>
          <span>Ticker</span>
          <span>Entry</span>
          <span>T1 short</span>
          <span>T2 long</span>
          <span>SL</span>
          <span>Hit?</span>
          <span>{pricesLoading ? "Now …" : "Now ●"}</span>
        </div>

        {active && !byDate.length && (
          <div className={styles.noMatch}>No picks are {active.label.toLowerCase()} right now.</div>
        )}

        {byDate.map(({ date, runs }) => (
          <div key={date} className={styles.dateGroup}>
            <div className={styles.dateHeader}>
              {fmtLongDate(date)}
              {runs.length > 1 && (
                <span className={styles.runCount}>{runs.length} runs</span>
              )}
            </div>
            {runs.map((run, i) => (
            <div key={run.runAt || i}>
            {runs.length > 1 && (
              <div className={styles.runHeader}>
                Run {runs.length - i} of {runs.length} · {fmtRun(run.runAt)}
                {i === 0 && <span className={styles.runLatest}>latest</span>}
              </div>
            )}
            {run.rows.map(p => {
              const isNew  = changedIds.has(p.id);
              const isOpen = expanded === p.id;
              return (
                <Fragment key={p.id}>
                <div
                  className={`${styles.tableRow} ${p.rank === 1 ? styles.rowTop : ""} ${isNew ? styles.rowNew : ""} ${isOpen ? styles.rowOpen : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  title={isOpen ? "Hide this call's trail" : "Show this call's trail"}
                  onClick={() => toggleTrail(p)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTrail(p); }
                  }}
                >
                  <span className={`${styles.rankBadge} ${p.rank === 1 ? styles.rankBest : styles.rankOther}`}>
                    {RANK_LABEL[p.rank] ?? `#${p.rank}`}
                  </span>
                  <span className={styles.cellTicker}>
                    <span className={styles.caret}>{isOpen ? "▾" : "▸"}</span>
                    {p.ticker}
                    <a
                      href={`https://www.tradingview.com/chart/?symbol=NSE:${p.ticker}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.tvLink}
                      onClick={e => e.stopPropagation()}
                    >↗</a>
                    {isNew && <span className={styles.newTag}>new</span>}
                  </span>
                  <span className={styles.levelCell}>
                    <span className={styles.cellLabel}>Entry</span>
                    <span className={styles.cellMono}>{fmt(p.price_at_pick)}</span>
                  </span>
                  <LevelCell price={p.target_short} pct={p.target_short_pct ?? null}      color="var(--accent)" label="T1" />
                  <LevelCell price={p.target}    pct={p.target_pct ?? null}                color="var(--accent)" label="T2" />
                  <LevelCell price={p.stop_loss} pct={p.stop_pct  ? -p.stop_pct : null}   color="var(--red)" label="SL" />
                  <HitCell
                    hit={p.target_hit}
                    slHit={p.sl_hit}
                    days={p.target_hit_days}
                    date={p.target_hit_date}
                    slDate={p.sl_hit_date}
                    slDays={p.sl_hit_days}
                    t1Hit={p.target_short_hit}
                    t1Date={p.target_short_hit_date}
                    t1Days={p.target_short_hit_days}
                    currentPrice={prices[p.ticker]}
                    target={p.target}
                  />
                  <NowCell entry={p.price_at_pick} now={prices[p.ticker]} label="Now" />
                </div>
                {isOpen && (
                  <CallTrail
                    pick={p}
                    events={trails[p.id] || []}
                    loading={!!trailState[p.id]?.loading}
                    error={trailState[p.id]?.error}
                  />
                )}
                </Fragment>
              );
            })}
            </div>
            ))}
          </div>
        ))}
      </div>

      {allDates.length > 0 && (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pagerBtn}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >← Newer</button>
          <span className={styles.pagerInfo}>
            Page {safePage + 1} of {pageCount} · {byDate.length} of {allDates.length} dates
          </span>
          <button
            type="button"
            className={styles.pagerBtn}
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >Older →</button>
        </div>
      )}

      <p className={styles.note}>
        "Now" prices are fetched for the dates on screen, a few symbols at a time, so the column fills in as they land. Hit? shows ✓ T2 when the daily high crossed the long target
        before a close fell below the SL, ✓ T1 when the short target was banked before the pick closed out on the SL (·SL)
        or the 45-day expiry (·exp), and ◐ T1 while T1 is in hand with T2 still open. Scoring starts the session after the
        pick date, and an intraday wick through the SL that recovers by the close is not a stop-out. A fresh pick also
        gets a 10-day grace window: for the first 10 days only a close below twice the stop distance (entry − 2R) counts
        as a stop-out, and the stored SL applies from day 11 onward. Click any row to see that call's trail — every
        change to its outcome, dated by the bar that caused it and stamped with the scan that recorded it.
      </p>
    </div>
  );
}
