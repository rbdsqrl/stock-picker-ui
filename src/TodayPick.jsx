import { useState, useEffect, useRef } from "react";
import styles from "./TodayPick.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";

const SIGNAL_META = {
  trend:        "Trend",
  momentum:     "Momentum",
  volume:       "Volume",
  breakout:     "Breakout",
  rel_strength: "Rel. Strength",
};

const RANK_LABELS = ["", "#1 Best Pick", "#2 Runner-Up", "#3", "#4", "#5"];

function ScoreBar({ score, basis }) {
  const pct = ((score + 1) / 2) * 100;
  const color = pct >= 65 ? "var(--accent)" : pct >= 45 ? "var(--yellow)" : "var(--red)";
  return (
    <>
      <div className={styles.scoreRow}>
        <span className={styles.scoreLabel}>Composite Score</span>
        <div className={styles.scoreTrack}>
          <div className={styles.scoreFill} style={{ width: `${pct}%`, background: color }} />
        </div>
        <span className={styles.scoreNum} style={{ color }}>
          {score >= 0 ? "+" : ""}{(score * 100).toFixed(0)}
        </span>
      </div>
      {basis && <p className={styles.scoreBasis}>{basis}</p>}
    </>
  );
}

function SignalRow({ name, data }) {
  const label = SIGNAL_META[name] || name;
  const s     = data?.score ?? 0;
  const dotCls = s === 1 ? styles.dotGreen : s === -1 ? styles.dotRed : styles.dotNeutral;

  let detail = "";
  if (name === "trend" && data.sma50 != null) {
    detail = `₹${data.price} · 50DMA ₹${data.sma50} · 200DMA ₹${data.sma200}`;
  } else if (name === "momentum" && data.rsi != null) {
    detail = `RSI ${data.rsi}`;
  } else if (name === "volume" && data.vol_ratio != null) {
    detail = `${data.vol_ratio}× 20-day avg`;
  } else if (name === "breakout" && data["52w_high"] != null) {
    detail = `${data.pct_from_high}% from 52W high ₹${data["52w_high"]}`;
  } else if (name === "rel_strength" && data.rel_strength != null) {
    detail = `${data.rel_strength > 0 ? "+" : ""}${data.rel_strength}% vs Nifty (1M)`;
  }

  return (
    <div className={styles.signalRow}>
      <span className={`${styles.dot} ${dotCls}`} />
      <span className={styles.signalName}>{label}</span>
      <span className={styles.signalVal}>{detail}</span>
    </div>
  );
}

function FundamentalsSection({ fundamentals: f }) {
  if (!f) return null;
  const { summary } = f;

  const fmtCr = (v) => {
    if (v == null) return null;
    return v >= 10000 ? `₹${(v / 100).toFixed(0)}K Cr` : `₹${v.toLocaleString("en-IN")} Cr`;
  };
  const fmtPct = (v) => (v != null ? `${v > 0 ? "+" : ""}${v}%` : null);

  const metrics = [
    { label: "Mkt Cap",      val: fmtCr(f.market_cap_cr),     color: null },
    { label: "P/E",          val: f.pe   != null ? `${f.pe}×` : null,      color: null },
    { label: "Fwd P/E",      val: f.pe_fwd != null ? `${f.pe_fwd}×` : null, color: null },
    { label: "Rev Growth",   val: fmtPct(f.rev_growth),        color: f.rev_growth > 0 ? "var(--accent)" : "var(--red)" },
    { label: "Earnings",     val: fmtPct(f.earnings_growth),   color: f.earnings_growth > 0 ? "var(--accent)" : "var(--red)" },
    { label: "Margin",       val: f.profit_margin != null ? `${f.profit_margin}%` : null, color: null },
    { label: "ROE",          val: f.roe != null ? `${f.roe}%` : null,       color: f.roe > 15 ? "var(--accent)" : null },
    { label: "D/E",          val: f.debt_to_equity != null ? `${f.debt_to_equity}` : null,
                               color: f.debt_to_equity > 2 ? "var(--red)" : null },
  ].filter(m => m.val != null);

  if (!metrics.length && !summary) return null;

  return (
    <div className={styles.analysisBlock}>
      <span className={styles.analysisLabel}>Fundamentals</span>
      {summary && <p className={styles.interpretText}>{summary}</p>}
      <div className={styles.metricsRow}>
        {metrics.map(m => (
          <span key={m.label} className={styles.metricChip}>
            <span className={styles.metricLabel}>{m.label}</span>
            <span className={styles.metricVal} style={{ color: m.color || "var(--text)" }}>{m.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function NewsSection({ news }) {
  const hasNews = news && news.length > 0;
  return (
    <div className={styles.analysisBlock}>
      <span className={styles.analysisLabel}>News · last 30 days</span>
      {!hasNews ? (
        <p className={styles.noNews}>No news found in the last 30 days.</p>
      ) : (
        <ul className={styles.newsList}>
          {news.map((item, i) => (
            <li key={i} className={styles.newsItem}>
              <span className={styles.newsMeta}>
                {[item.publisher, item.date].filter(Boolean).join(" · ")}
              </span>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className={styles.newsLink}>
                {item.title}
              </a>
              {item.summary && <p className={styles.newsSummary}>{item.summary}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PickCard({ pick, isTop }) {
  const {
    ticker, company, sector, score, signals, rationale,
    stop_loss, stop_pct, target, target_pct,
    entry_cmp, entry_breakout, atr_14, rr_ratio,
    target_days_est,
    screened_count, run_at, rank, news, fundamentals,
    price,
  } = pick;

  const displayPrice = entry_cmp ?? price;
  const runTime = run_at
    ? new Date(run_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";
  const rrDisplay = rr_ratio
    ? `1 : ${rr_ratio}`
    : (target && displayPrice && stop_loss)
      ? `1 : ${((target - displayPrice) / (displayPrice - stop_loss)).toFixed(1)}`
      : "—";

  return (
    <div className={`${styles.card} ${isTop ? styles.cardBest : ""}`}>

      {/* Rank + meta */}
      <div className={styles.cardHead}>
        <span className={`${styles.rankBadge} ${isTop ? styles.rankBest : styles.rankOther}`}>
          {RANK_LABELS[rank]}
        </span>
        <span className={styles.runMeta}>
          {[runTime, screened_count && `${screened_count} stocks`].filter(Boolean).join(" · ")}
        </span>
      </div>

      {/* Ticker + price */}
      <div className={styles.stockRow}>
        <div>
          <div className={styles.tickerLine}>
            <span className={styles.ticker}>{ticker}</span>
            <span className={styles.sectorTag}>{sector}</span>
            <a
              href={`https://www.tradingview.com/chart/?symbol=NSE:${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.tvLink}
            >TradingView ↗</a>
          </div>
          <div className={styles.company}>{company}</div>
        </div>
        <div className={styles.priceCol}>
          <div className={styles.ltp}>₹{displayPrice?.toLocaleString("en-IN")}</div>
          <div className={styles.ltpLabel}>LTP at screening</div>
        </div>
      </div>

      <ScoreBar score={score} basis={pick.score_basis} />

      {/* Trade levels */}
      <div className={styles.levelsSection}>

        <div className={styles.entryGroup}>
          <span className={styles.levelGroupLabel}>Entry</span>
          <div className={styles.entryBoxes}>
            <div className={styles.levelBox}>
              <span className={styles.levelBoxLabel}>Enter at open</span>
              <span className={styles.levelBoxVal}>₹{displayPrice?.toLocaleString("en-IN")}</span>
            </div>
            {entry_breakout && (
              <div className={styles.levelBox}>
                <span className={styles.levelBoxLabel}>Breakout buy-stop</span>
                <span className={styles.levelBoxVal}>₹{entry_breakout?.toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.riskGroup}>
          <span className={styles.levelGroupLabel}>Risk / Reward · ATR-based</span>
          <div className={styles.riskBoxes}>
            <div className={styles.levelBox}>
              <span className={styles.levelBoxLabel}>Stop Loss</span>
              <span className={styles.levelBoxVal} style={{ color: "var(--red)" }}>
                ₹{stop_loss?.toLocaleString("en-IN")}
                {stop_pct && (
                  <span className={styles.pctPill} style={{ background: "rgba(173,116,116,0.13)", color: "var(--red)" }}>
                    −{stop_pct}%
                  </span>
                )}
              </span>
            </div>
            <div className={styles.levelBox}>
              <span className={styles.levelBoxLabel}>Target</span>
              <span className={styles.levelBoxVal} style={{ color: "var(--accent)" }}>
                ₹{target?.toLocaleString("en-IN")}
                {target_pct && (
                  <span className={styles.pctPill} style={{ background: "rgba(127,181,154,0.13)", color: "var(--accent)" }}>
                    +{target_pct}%
                  </span>
                )}
              </span>
              {target_days_est && (
                <span className={styles.levelBoxMeta}>~{target_days_est} trading days</span>
              )}
            </div>
            <div className={styles.levelBox}>
              <span className={styles.levelBoxLabel}>Risk : Reward</span>
              <span className={styles.levelBoxVal}>{rrDisplay}</span>
            </div>
            {atr_14 && (
              <div className={styles.levelBox}>
                <span className={styles.levelBoxLabel}>ATR 14d</span>
                <span className={styles.levelBoxVal}>₹{atr_14?.toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Analysis sections */}
      <div className={styles.analysisSections}>

        <div className={styles.analysisBlock}>
          <span className={styles.analysisLabel}>Technicals</span>
          {rationale && <p className={styles.interpretText}>{rationale}</p>}
          <div className={styles.signalList}>
            {Object.entries(signals || {}).map(([name, data]) => (
              <SignalRow key={name} name={name} data={data} />
            ))}
          </div>
        </div>

        {pick.valuation?.summary && (
          <div className={styles.analysisBlock}>
            <span className={styles.analysisLabel}>Valuation case</span>
            <p className={styles.interpretText}>{pick.valuation.summary}</p>
          </div>
        )}

        <FundamentalsSection fundamentals={fundamentals} />
        <NewsSection news={news} />

      </div>
    </div>
  );
}

function LogPanel({ logs, onStop, screenStatus, attached }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [logs]);

  const isDone = ["done", "stopped", "error"].includes(screenStatus);

  return (
    <div className={styles.logWrap}>
      <div className={styles.logHeader}>
        <span className={styles.logTitle}>
          {isDone
            ? "Screening complete"
            : <><span className={styles.spinnerSm} />
                {attached ? " Following the run in progress..." : " Running screener..."}</>}
        </span>
        {!isDone && (
          <button className={styles.stopBtn} onClick={onStop}>■ Stop</button>
        )}
      </div>
      {attached && !isDone && (
        <div className={styles.attachedNote}>
          A screening run was already under way, so this is following it rather than
          starting a second one — the screen is the same for everybody.
        </div>
      )}
      <div className={styles.logBody} ref={bodyRef}>
        {logs.map((line, i) => {
          const isPick  = line.includes("=== Results") || /\s#[123]\s/.test(line);
          const isOk    = line.includes("✓ READY");
          // Rejections now carry the reason rather than the word "skipped", so the
          // ✕ marker is what identifies them.
          const isSkip  = line.includes("✕");
          const isWarn  = line.includes("WARNING") || line.includes("rate limited")
                       || line.includes("throttled") || line.includes("abandoned");
          const isErr   = /error|Error|Abort/i.test(line);
          const cls = isPick ? styles.logPick
                    : isErr  ? styles.logErr
                    : isWarn ? styles.logWarn
                    : isOk   ? styles.logOk
                    : isSkip ? styles.logSkip
                    : styles.logLine;
          return <div key={i} className={cls}>{line}</div>;
        })}
      </div>
    </div>
  );
}

export default function TodayPick() {
  const [state, setState]               = useState("idle");
  const [picks, setPicks]               = useState([]);
  const [running, setRunning]           = useState(false);
  const [logs, setLogs]                 = useState([]);
  const [screenStatus, setScreenStatus] = useState("idle");
  // True when we joined a run someone else (or the scheduler) started.
  const [attached, setAttached]         = useState(false);
  const pollRef = useRef(null);

  const fetchPicks = async () => {
    setState("loading");
    try {
      const res  = await fetch(`${API}/api/pick/today`);
      const data = await res.json();
      if (data.status === "ok" && data.picks?.length) {
        setPicks(data.picks);
        setState("ok");
      } else {
        setState("empty");
      }
    } catch {
      setState("error");
    }
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const stopScreen = async () => {
    await fetch(`${API}/api/screen/stop`, { method: "POST" });
  };

  // Follow the run that is in flight. Safe to call more than once — it never opens a
  // second poller, so attaching on mount and on a click cannot stack.
  const followRun = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/api/screen/status`);
        const data = await res.json();
        setLogs(data.logs || []);
        setScreenStatus(data.status);
        if (data.status === "done") {
          stopPolling();
          setRunning(false);
          setAttached(false);
          await fetchPicks();
        } else if (data.status === "stopped" || data.status === "error") {
          stopPolling();
          setRunning(false);
          setAttached(false);
        }
      } catch { /* network blip */ }
    }, 1500);
  };

  const runScreen = async () => {
    setRunning(true);
    setScreenStatus("running");
    try {
      const res  = await fetch(`${API}/api/screen/run`, { method: "POST" });
      const data = await res.json();
      // The screen is identical for every user and costs ~500 upstream fetches, so
      // the server hands back the run already in progress rather than starting a
      // second one. Show that run's logs instead of pretending we started fresh.
      if (data.status === "already_running") {
        setAttached(true);
        setLogs(data.logs || []);
      } else {
        setAttached(false);
        setLogs([]);
      }
    } catch {
      setRunning(false);
      setScreenStatus("error");
      return;
    }
    followRun();
  };

  useEffect(() => {
    fetchPicks();
    // A run may already be under way when the page opens — started by the scheduler
    // or by somebody else. Show it rather than offering a button that would just
    // attach to it anyway.
    (async () => {
      try {
        const res  = await fetch(`${API}/api/screen/status`);
        const data = await res.json();
        if (data.status === "running") {
          setRunning(true);
          setAttached(true);
          setLogs(data.logs || []);
          setScreenStatus("running");
          followRun();
        }
      } catch { /* backend unreachable — fetchPicks already surfaces that */ }
    })();
    return stopPolling;
  }, []);

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });

  if (state === "loading") return (
    <div className={styles.center}>
      <div className={styles.spinner} />
      <p className={styles.loadMsg}>Fetching today's picks...</p>
    </div>
  );

  if (state === "error") return (
    <div className={styles.center}>
      <p className={styles.errorMsg}>Cannot reach backend. Is the server running on port 8001?</p>
      <button className={styles.btn} onClick={fetchPicks}>Retry</button>
    </div>
  );

  if (state === "empty" || state === "idle") return (
    <div className={styles.center}>
      {!running && (
        <>
          <div className={styles.emptyIcon}>◈</div>
          <p className={styles.emptyHead}>No picks yet for {today}</p>
          <p className={styles.emptyBody}>Run the screener to analyse Nifty 500 and surface today's top 3 setups.</p>
        </>
      )}
      <button className={styles.btn} onClick={runScreen} disabled={running}>
        {running ? (attached ? "Following run..." : "Running...") : "Run Screener"}
      </button>
      {running && <LogPanel logs={logs} onStop={stopScreen} screenStatus={screenStatus} attached={attached} />}
      {!running && screenStatus === "stopped" && (
        <p className={styles.runNote}>Screening stopped. Run again to get picks.</p>
      )}
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <div>
          <div className={styles.dateLabel}>{today}</div>
          <div className={styles.headline}>Today's Top Picks</div>
        </div>
        <button className={styles.rerunBtn} onClick={runScreen} disabled={running} title="Re-run screener">
          {running ? <span className={styles.spinnerSm} /> : "↺ Re-run"}
        </button>
      </div>

      {running && <LogPanel logs={logs} onStop={stopScreen} screenStatus={screenStatus} attached={attached} />}

      <div className={styles.pickList}>
        {picks.map(pick => (
          <PickCard key={pick.rank} pick={pick} isTop={pick.rank === 1} />
        ))}
      </div>

      <p className={styles.disclaimer}>
        Algorithmic screening output only. News sentiment is keyword-based. Not financial advice.
      </p>
    </div>
  );
}
