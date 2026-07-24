import { useState, useEffect, useRef } from "react";
import styles from "./Watchlist.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";

function fmt(v) {
  if (v == null) return "—";
  return `₹${v.toLocaleString("en-IN")}`;
}

const EARLY_SIGNAL_META = {
  higher_lows:      "Higher Lows",
  macd_crossover:   "MACD",
  rsi_recovery:     "RSI Recovery",
  obv_accumulation: "OBV Trend",
  bb_squeeze:       "BB Squeeze",
  rel_strength:     "Rel. Strength",
};

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

function SignalPills({ signals }) {
  if (!signals) return null;
  return (
    <div className={styles.pillRow}>
      {Object.entries(signals).map(([name, data]) => {
        const label = EARLY_SIGNAL_META[name] || name;
        const s = data?.score ?? 0;
        const cls = s === 1 ? styles.pillOn : s === -1 ? styles.pillOff : styles.pillNeutral;
        return (
          <span key={name} className={`${styles.pill} ${cls}`}>{label}</span>
        );
      })}
    </div>
  );
}

function WatchlistRow({ pick, now }) {
  const [open, setOpen] = useState(false);
  const { ticker, company, sector, price_at_pick, pct_from_52w_high,
          setup_summary, watch_for, signals,
          stop_loss, stop_pct, target, target_pct, rr_ratio, rank,
          news_sentiment } = pick;

  return (
    <>
      <div
        className={styles.tableRow}
        onClick={() => setOpen(o => !o)}
        style={{ cursor: "pointer" }}
      >
        <span className={styles.rankBadge}>◈ #{rank}</span>
        <span className={styles.cellTicker}>{ticker}</span>
        <span className={styles.cellCompany}>{company}</span>
        <SignalPills signals={signals} />
        <span className={styles.cellMono}>{fmt(price_at_pick)}</span>
        <NowCell entry={price_at_pick} now={now} />
        <span className={styles.fromHigh}>
          {pct_from_52w_high != null ? `${pct_from_52w_high}%` : "—"}
        </span>
      </div>

      {open && (
        <div className={styles.expandRow}>
          <div className={styles.expandGrid}>
            <div className={styles.expandBlock}>
              <span className={styles.expandLabel}>Signals firing</span>
              <span className={styles.expandVal} style={{ color: "var(--yellow)" }}>{setup_summary || "—"}</span>
            </div>
            <div className={styles.expandBlock}>
              <span className={styles.expandLabel}>Watch for</span>
              <span className={styles.expandVal}>{watch_for || "—"}</span>
            </div>
            <div className={styles.expandBlock}>
              <span className={styles.expandLabel}>Indicative stop</span>
              <span className={styles.expandVal} style={{ color: "var(--red)" }}>
                {fmt(stop_loss)}{stop_pct ? ` (−${stop_pct}%)` : ""}
              </span>
            </div>
            <div className={styles.expandBlock}>
              <span className={styles.expandLabel}>Indicative target</span>
              <span className={styles.expandVal} style={{ color: "var(--accent)" }}>
                {fmt(target)}{target_pct ? ` (+${target_pct}%)` : ""}
              </span>
            </div>
            {rr_ratio && (
              <div className={styles.expandBlock}>
                <span className={styles.expandLabel}>R:R</span>
                <span className={styles.expandVal}>1 : {rr_ratio}</span>
              </div>
            )}
            <div className={styles.expandBlock}>
              <span className={styles.expandLabel}>Sector</span>
              <span className={styles.expandVal}>{sector || "—"}</span>
            </div>
            {news_sentiment != null && news_sentiment !== 0 && (
              <div className={styles.expandBlock}>
                <span className={styles.expandLabel}>News (5d)</span>
                <span className={styles.expandVal} style={{ color: news_sentiment === 1 ? "var(--accent)" : "var(--red)" }}>
                  {news_sentiment === 1 ? "Positive catalyst" : "Negative — caution"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default function Watchlist() {
  const [history, setHistory]         = useState([]);
  const [prices, setPrices]           = useState({});
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [screenStatus, setScreenStatus] = useState("idle");
  const [lastLog, setLastLog]         = useState("");
  const pollRef = useRef(null);

  const loadPrices = async (rows) => {
    const tickers = [...new Set(rows.map(p => p.ticker))];
    if (!tickers.length) return;
    try {
      const res = await fetch(`${API}/api/prices?tickers=${tickers.join(",")}`);
      setPrices(await res.json());
    } catch { /* network */ }
  };

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/watchlist/history`)
      .then(r => r.json())
      .then(d => {
        const rows = d.picks || [];
        setHistory(rows);
        setLoading(false);
        loadPrices(rows);
      })
      .catch(() => setLoading(false));
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const runScreen = async () => {
    setRunning(true);
    setScreenStatus("running");
    setLastLog("");
    try {
      const res = await fetch(`${API}/api/screen/run`, { method: "POST" });
      const data = await res.json();
      if (data.status === "already_running") {
        // Already running from another tab — just poll until done
      }
    } catch {
      setRunning(false);
      setScreenStatus("error");
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/api/screen/status`);
        const data = await res.json();
        const logs = data.logs || [];
        if (logs.length) setLastLog(logs[logs.length - 1]);
        setScreenStatus(data.status);
        if (data.status === "done") {
          stopPolling();
          setRunning(false);
          load();
        } else if (data.status === "stopped" || data.status === "error") {
          stopPolling();
          setRunning(false);
        }
      } catch { /* network blip */ }
    }, 1500);
  };

  useEffect(() => { load(); return stopPolling; }, []);

  if (loading && !history.length) {
    return <div className={styles.center}><div className={styles.spinner} /></div>;
  }

  if (!history.length) return (
    <div className={styles.center}>
      <div className={styles.emptyIcon}>◈</div>
      <p className={styles.emptyHead}>No watchlist history yet</p>
      <p className={styles.emptyBody}>
        Setting Up picks will appear here after the screener runs. They show stocks
        with early signals — before the main move begins.
      </p>
      <button className={styles.rerunBtn} onClick={runScreen} disabled={running}>
        {running ? <><span className={styles.spinnerSm} /> Running...</> : "↻ Run Screener"}
      </button>
    </div>
  );

  // Group by date
  const byDate = [];
  const seen   = {};
  for (const p of history) {
    if (!seen[p.date]) { seen[p.date] = []; byDate.push({ date: p.date, rows: seen[p.date] }); }
    seen[p.date].push(p);
  }

  const fmtDate = (iso) => new Date(iso + "T00:00:00")
    .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <div>
          <div className={styles.dateLabel}>EARLY SIGNALS</div>
          <div className={styles.headline}>Setting Up — History</div>
        </div>
        <div className={styles.btnGroup}>
          <button className={styles.refreshBtn} onClick={load} disabled={running}>↺ Refresh</button>
          <button className={styles.rerunBtn} onClick={runScreen} disabled={running} title="Re-run screener to regenerate today's picks">
            {running ? <><span className={styles.spinnerSm} />Running...</> : "↻ Rerun Picks"}
          </button>
        </div>
      </div>

      {running && (
        <div className={styles.runStatus}>
          <span className={styles.spinnerSm} />
          <span>Screening Nifty 500 — takes a few minutes</span>
          {lastLog && <span className={styles.runLog}>{lastLog}</span>}
        </div>
      )}

      <p className={styles.intro}>
        Stocks flagged by leading indicators before the main move. Only stocks within 15% of their
        52W high shown — genuinely close to a breakout. Click any row to expand.
      </p>

      <div className={styles.tableWrap}>
        <div className={styles.tableHead}>
          <span>Rank</span>
          <span>Ticker</span>
          <span>Company</span>
          <span>Signals</span>
          <span>Entry</span>
          <span>Now ●</span>
          <span>From High</span>
        </div>

        {byDate.map(({ date, rows }) => (
          <div key={date} className={styles.dateGroup}>
            <div className={styles.dateHeader}>{fmtDate(date)}</div>
            {rows.map(p => (
              <WatchlistRow key={p.id} pick={p} now={prices[p.ticker]} />
            ))}
          </div>
        ))}
      </div>

      <p className={styles.note}>
        Indicative levels shown in expanded view are ATR-based projections at time of screening — not entry signals.
        Enter only after confirming with the "Watch for" trigger.
      </p>
    </div>
  );
}
