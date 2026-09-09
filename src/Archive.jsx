import { useState, useEffect, useMemo } from "react";
import styles from "./History.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";
const RANK_LABEL = { 1: "#1", 2: "#2", 3: "#3" };
const DATES_PER_PAGE = 5;

function fmt(v) {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
}

function fmtLongDate(iso) {
  return new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtRun(iso) {
  if (!iso) return "earlier run";
  const d = new Date(iso);
  return isNaN(d) ? "earlier run"
    : d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// Same grouping rule as History: a date can hold several runs, since a re-run on
// the same day no longer overwrites the earlier call.
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

function LevelCell({ price, pct, color }) {
  return (
    <span className={styles.levelCell}>
      <span className={styles.cellMono} style={{ color }}>{fmt(price)}</span>
      {pct != null && <span className={styles.pctNote}>{pct > 0 ? `+${pct}` : pct}%</span>}
    </span>
  );
}

// Frozen data only — no live price, so there is no "↑ live" branch here, unlike
// History's HitCell. A pick that was still open when frozen just reads "—".
function HitCell({ hit, slHit, days, date, slDate, slDays, t1Hit, t1Date, t1Days }) {
  if (hit === 1) return (
    <span className={styles.hitYes} title={date ? `T2 hit on ${date}` : undefined}>
      ✓ T2 {days != null ? `${days}d` : ""}
    </span>
  );
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
  if (hit === 0 && t1Hit === 1) return (
    <span className={styles.hitT1Won} title={`T1 hit on ${t1Date} — T2 never reached, expired at 45d`}>
      ✓ T1 {t1Days != null ? `${t1Days}d` : ""} · exp
    </span>
  );
  if (hit === 0) return <span className={styles.hitNo}>✗ missed</span>;
  if (t1Hit === 1) return (
    <span className={styles.hitT1} title={t1Date ? `T1 reached on ${t1Date} — frozen before T2 resolved` : undefined}>
      ◐ T1 {t1Days != null ? `${t1Days}d` : ""}
    </span>
  );
  return <span className={styles.hitPending} title="Still open when frozen — this call will not be re-scored">— frozen open</span>;
}

export default function Archive() {
  const [picks, setPicks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(0);

  useEffect(() => {
    fetch(`${API}/api/pick/archive`)
      .then(r => r.json())
      .then(d => { setPicks(d.picks || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const allDates  = useMemo(() => groupByDate(picks), [picks]);
  const pageCount = Math.max(1, Math.ceil(allDates.length / DATES_PER_PAGE));
  const safePage  = Math.min(page, pageCount - 1);
  const byDate    = allDates.slice(safePage * DATES_PER_PAGE, (safePage + 1) * DATES_PER_PAGE);

  if (loading) return <div className={styles.center}><div className={styles.spinner} /></div>;

  if (!picks.length) return (
    <div className={styles.center}>
      <div className={styles.emptyIcon}>◈</div>
      <p className={styles.emptyHead}>Nothing archived yet</p>
      <p className={styles.emptyBody}>Calls moved here stay fixed as they stood on the day they were frozen — they are no longer re-scored.</p>
    </div>
  );

  const top     = picks.filter(p => p.rank === 1 && p.target_hit != null);
  const hitRate = top.length > 0
    ? Math.round((top.filter(p => p.target_hit === 1).length / top.length) * 100)
    : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <div>
          <div className={styles.dateLabel}>FROZEN SNAPSHOT</div>
          <div className={styles.headline}>Archive</div>
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
        </div>
      </div>

      <p className={styles.note}>
        Calls given before this archive was created, frozen exactly as they stood that day —
        outcomes here will not change on future refreshes. Still-open calls at the time of
        freezing show as "frozen open" rather than being tracked further.
      </p>

      <div className={styles.tableWrap}>
        <div className={styles.tableHead}>
          <span>Rank</span>
          <span>Ticker</span>
          <span>Entry</span>
          <span>T1 short</span>
          <span>T2 long</span>
          <span>SL</span>
          <span>Outcome</span>
        </div>

        {byDate.map(({ date, runs }) => (
          <div key={date} className={styles.dateGroup}>
            <div className={styles.dateHeader}>
              {fmtLongDate(date)}
              {runs.length > 1 && <span className={styles.runCount}>{runs.length} runs</span>}
            </div>
            {runs.map((run, i) => (
              <div key={run.runAt || i}>
                {runs.length > 1 && (
                  <div className={styles.runHeader}>
                    Run {runs.length - i} of {runs.length} · {fmtRun(run.runAt)}
                    {i === 0 && <span className={styles.runLatest}>latest</span>}
                  </div>
                )}
                {run.rows.map(p => (
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
                    <LevelCell price={p.target_short} pct={p.target_short_pct ?? null} color="var(--accent)" />
                    <LevelCell price={p.target}       pct={p.target_pct ?? null}       color="var(--accent)" />
                    <LevelCell price={p.stop_loss}    pct={p.stop_pct ? -p.stop_pct : null} color="var(--red)" />
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
                    />
                  </div>
                ))}
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
    </div>
  );
}
