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

function HitCell({ hit, days, date, currentPrice, target }) {
  if (hit === 1) return (
    <span className={styles.hitYes} title={date ? `Hit on ${date}` : undefined}>
      ✓ {days != null ? `${days}d` : ""}
    </span>
  );
  if (hit === 0) return <span className={styles.hitNo}>✗ missed</span>;
  if (hit == null && currentPrice != null && target != null && currentPrice >= target)
    return <span className={styles.hitLive} title="Live price at or above target — will confirm on next refresh">↑ live</span>;
  return <span className={styles.hitPending}>—</span>;
}

export default function History() {
  const [picks, setPicks]           = useState([]);
  const [prices, setPrices]         = useState({});
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

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

  const byDate = [];
  const seen   = {};
  for (const p of picks) {
    if (!seen[p.date]) { seen[p.date] = []; byDate.push({ date: p.date, rows: seen[p.date] }); }
    seen[p.date].push(p);
  }

  const top     = picks.filter(p => p.rank === 1 && p.target_hit != null);
  const hitRate = top.length > 0
    ? Math.round((top.filter(p => p.target_hit === 1).length / top.length) * 100)
    : null;

  const fmtDate = (iso) => new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

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
            {refreshing ? "Recalculating..." : "↺ Refresh"}
          </button>
        </div>
      </div>

      {refreshResult && (
        <div className={refreshResult.error || (refreshResult.failed && refreshResult.failed.length) ? styles.refreshError : styles.refreshOk}>
          {refreshResult.error
            ? refreshResult.error
            : `Updated ${refreshResult.hits_updated} outcome(s).${refreshResult.failed?.length ? ` Skipped (fetch error): ${refreshResult.failed.join(", ")}` : ""}`
          }
        </div>
      )}

      <div className={styles.tableWrap}>
        <div className={styles.tableHead}>
          <span>Rank</span>
          <span>Ticker</span>
          <span>Entry</span>
          <span>Target</span>
          <span>SL</span>
          <span>Hit?</span>
          <span>Now ●</span>
        </div>

        {byDate.map(({ date, rows }) => (
          <div key={date} className={styles.dateGroup}>
            <div className={styles.dateHeader}>{fmtDate(date)}</div>
            {rows.map(p => {
              return (
                <div key={p.id} className={`${styles.tableRow} ${p.rank === 1 ? styles.rowTop : ""}`}>
                  <span className={`${styles.rankBadge} ${p.rank === 1 ? styles.rankBest : styles.rankOther}`}>
                    {RANK_LABEL[p.rank] ?? `#${p.rank}`}
                  </span>
                  <span className={styles.cellTicker}>{p.ticker}</span>
                  <span className={styles.cellMono}>{fmt(p.price_at_pick)}</span>
                  <LevelCell price={p.target}    pct={p.target_pct ?? null}                color="var(--accent)" />
                  <LevelCell price={p.stop_loss} pct={p.stop_pct  ? -p.stop_pct : null}   color="var(--red)" />
                  <HitCell hit={p.target_hit} days={p.target_hit_days} date={p.target_hit_date} currentPrice={prices[p.ticker]} target={p.target} />
                  <NowCell entry={p.price_at_pick} now={prices[p.ticker]} />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className={styles.note}>
        "Now" and target outcomes refresh on every page load. Hit? marks ✓ when the stock's daily high crossed the target.
      </p>
    </div>
  );
}
