import { useState, useEffect } from "react";
import styles from "./History.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";
const RANK_LABEL = { 1: "#1", 2: "#2", 3: "#3" };

function fmt(v) {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
}

function NowCell({ entry, now }) {
  if (now == null) return <span className={styles.cellMono}>—</span>;
  const pct = ((now - entry) / entry * 100).toFixed(1);
  const up  = now >= entry;
  return (
    <span className={styles.nowLive}>
      <span className={styles.nowBadge}>
        <span className={styles.liveDot} />
        <span className={styles.cellMono}>{fmt(now)}</span>
      </span>
      <span className={up ? styles.chgUp : styles.chgDown}>{up ? "+" : ""}{pct}%</span>
    </span>
  );
}

function LevelCell({ price, pct, color }) {
  return (
    <span className={styles.levelCell}>
      <span className={styles.cellMono} style={{ color }}>{fmt(price)}</span>
      {pct != null && <span className={styles.pctNote}>{pct > 0 ? `+${pct}` : pct}%</span>}
    </span>
  );
}

function HitCell({ hit, slHit, days, date, slDate, slDays, currentPrice, target,
                   t1Hit, t1Date, t1Days }) {
  if (hit === 1) return (
    <span className={styles.hitYes} title={date ? `T2 hit on ${date}` : undefined}>
      ✓ T2 {days != null ? `${days}d` : ""}
    </span>
  );
  // T1 is a high touch and the SL is judged on the close, so on any bar where both
  // register the T1 touch necessarily came first. A pick that reached T1 banked that
  // gain before it was stopped — that is a T1 hit, not a plain stop-out.
  if (slHit === 1 && t1Hit === 1) return (
    <span className={styles.hitT1Won}
          title={`T1 hit on ${t1Date} — before the SL closed below on ${slDate}`}>
      ✓ T1 {t1Days != null ? `${t1Days}d` : ""} · SL
    </span>
  );
  if (hit === 0 && slHit === 1) return (
    <span className={styles.hitNo} title={slDate ? `SL closed below on ${slDate}` : "Stopped out"}>
      ✗ SL {slDays != null ? `${slDays}d` : ""}
    </span>
  );
  // Expired at 45 days. T1 may still have been reached along the way.
  if (hit === 0 && t1Hit === 1) return (
    <span className={styles.hitT1Won} title={`T1 hit on ${t1Date} — T2 never reached, expired at 45d`}>
      ✓ T1 {t1Days != null ? `${t1Days}d` : ""} · exp
    </span>
  );
  if (hit === 0) return <span className={styles.hitNo}>✗ missed</span>;
  // Still open, but the short target is already in hand — the move is underway.
  if (t1Hit === 1) return (
    <span className={styles.hitT1} title={t1Date ? `T1 reached on ${t1Date} — T2 still open` : undefined}>
      ◐ T1 {t1Days != null ? `${t1Days}d` : ""}
    </span>
  );
  if (currentPrice != null && target != null && currentPrice >= target)
    return <span className={styles.hitLive} title="Live price at or above target — will confirm on next refresh">↑ live</span>;
  return <span className={styles.hitPending}>—</span>;
}

export default function History() {
  const [picks, setPicks]           = useState([]);
  const [prices, setPrices]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [statFilter, setStatFilter] = useState(null);

  const loadPrices = async (rows) => {
    const tickers = [...new Set(rows.map(p => p.ticker))];
    if (!tickers.length) return;
    try {
      const res  = await fetch(`${API}/api/prices?tickers=${tickers.join(",")}`);
      setPrices(await res.json());
    } catch { /* network */ }
  };

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/pick/history`)
      .then(r => r.json())
      .then(d => {
        const rows = d.picks || [];
        setPicks(rows);
        setLoading(false);
        loadPrices(rows);
      })
      .catch(() => setLoading(false));
  };

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
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

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

  // Each stat chip doubles as a filter over the table below, so the counts stay the
  // way you drill into them. Predicates live here so the number on the chip and the
  // rows it reveals can never drift apart.
  const STAT_FILTERS = [
    { key: "hits",    label: "Hits",       color: "var(--accent)", border: "rgba(74,222,128,0.3)",
      match: p => p.target_hit === 1 },
    { key: "misses",  label: "Misses",     color: "var(--red)",    border: "rgba(248,113,113,0.3)",
      match: p => p.target_hit === 0 },
    { key: "waiting", label: "Waiting",    color: "var(--yellow)", border: null,
      match: p => p.target_hit == null },
    // Open picks that already tagged the short target — the move is underway.
    { key: "t1",      label: "T1 in play", color: "var(--accent)", border: "rgba(74,222,128,0.3)",
      opacity: 0.72, match: p => p.target_hit == null && p.target_short_hit === 1 },
  ];

  const active   = STAT_FILTERS.find(f => f.key === statFilter);
  const shown    = active ? picks.filter(active.match) : picks;

  // Re-running the screener on the same day no longer overwrites the earlier call —
  // every run is kept — so a date can hold several sets of picks. Group by date, then
  // by run inside it, and only surface the run header when there is more than one.
  const byDate = [];
  const seenDate = {};
  for (const p of shown) {
    const runKey = p.run_at || "";
    if (!seenDate[p.date]) {
      seenDate[p.date] = { runs: [], byRun: {} };
      byDate.push({ date: p.date, ...seenDate[p.date] });
    }
    const group = seenDate[p.date];
    if (!group.byRun[runKey]) {
      group.byRun[runKey] = { runAt: p.run_at, rows: [] };
      group.runs.push(group.byRun[runKey]);
    }
    group.byRun[runKey].rows.push(p);
  }

  const fmtDate = (iso) => new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const fmtRun = (iso) => {
    if (!iso) return "earlier run";
    const d = new Date(iso);
    return isNaN(d) ? "earlier run"
      : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

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
        {STAT_FILTERS.map(f => {
          const count = picks.filter(f.match).length;
          const on    = statFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              title={on ? `Showing ${f.label.toLowerCase()} only — click to clear` : `Show ${f.label.toLowerCase()} only`}
              className={`${styles.statChip} ${on ? styles.statChipOn : ""}`}
              style={f.border ? { borderColor: f.border } : undefined}
              onClick={() => setStatFilter(on ? null : f.key)}
            >
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

      {refreshResult && (
        <div className={refreshResult.error || (refreshResult.failed && refreshResult.failed.length) ? styles.refreshError : styles.refreshOk}>
          {refreshResult.error
            ? refreshResult.error
            : `Re-resolved ${refreshResult.hits} hit(s), ${refreshResult.misses} miss(es), ${refreshResult.pending} still open (${refreshResult.t1_hits} reached T1) — ${refreshResult.hits_updated} outcome(s) changed.${refreshResult.failed?.length ? ` Skipped (fetch error): ${refreshResult.failed.join(", ")}` : ""}`
          }
        </div>
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
          <span>Now ●</span>
        </div>

        {active && !byDate.length && (
          <div className={styles.noMatch}>No picks are {active.label.toLowerCase()} right now.</div>
        )}

        {byDate.map(({ date, runs }) => (
          <div key={date} className={styles.dateGroup}>
            <div className={styles.dateHeader}>
              {fmtDate(date)}
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
              return (
                <div key={p.id} className={`${styles.tableRow} ${p.rank === 1 ? styles.rowTop : ""}`}>
                  <span className={`${styles.rankBadge} ${p.rank === 1 ? styles.rankBest : styles.rankOther}`}>
                    {RANK_LABEL[p.rank] ?? `#${p.rank}`}
                  </span>
                  <span className={styles.cellTicker}>
                    {p.ticker}
                    <a
                      href={`https://www.tradingview.com/chart/?symbol=NSE:${p.ticker}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.tvLink}
                    >↗</a>
                  </span>
                  <span className={styles.cellMono}>{fmt(p.price_at_pick)}</span>
                  <LevelCell price={p.target_short} pct={p.target_short_pct ?? null}      color="var(--accent)" />
                  <LevelCell price={p.target}    pct={p.target_pct ?? null}                color="var(--accent)" />
                  <LevelCell price={p.stop_loss} pct={p.stop_pct  ? -p.stop_pct : null}   color="var(--red)" />
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
                  <NowCell entry={p.price_at_pick} now={prices[p.ticker]} />
                </div>
              );
            })}
            </div>
            ))}
          </div>
        ))}
      </div>

      <p className={styles.note}>
        "Now" and target outcomes refresh on every page load. Hit? shows ✓ T2 when the daily high crossed the long target
        before a close fell below the SL, ✓ T1 when the short target was banked before the pick closed out on the SL (·SL)
        or the 45-day expiry (·exp), and ◐ T1 while T1 is in hand with T2 still open. Scoring starts the session after the
        pick date, and an intraday wick through the SL that recovers by the close is not a stop-out.
      </p>
    </div>
  );
}
