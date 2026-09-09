import { useState, useRef } from "react";
import styles from "./Analyse.module.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:8001";

function fmt(v) {
  if (v == null) return "—";
  return `₹${Number(v).toLocaleString("en-IN")}`;
}

function fmtCap(cr) {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)}L Cr`;
  if (cr >= 1000)   return `₹${(cr / 1000).toFixed(1)}K Cr`;
  return `₹${cr} Cr`;
}

function ScoreBadge({ score }) {
  const pct   = Math.round(((score ?? 0) + 1) / 2 * 100);
  const label = pct >= 65 ? "BULLISH" : pct >= 40 ? "NEUTRAL" : "BEARISH";
  const color = pct >= 65 ? "var(--accent)" : pct >= 40 ? "var(--yellow)" : "var(--red)";
  return (
    <div className={styles.scoreBadge}>
      <span className={styles.scoreNum} style={{ color }}>{pct}</span>
      <span className={styles.scoreLabel} style={{ color }}>{label}</span>
    </div>
  );
}

function FundamentalScoreBadge({ score, nFactors }) {
  if (score == null) return null;
  const label = score >= 65 ? "STRONG" : score >= 40 ? "AVERAGE" : "WEAK";
  const color = score >= 65 ? "var(--accent)" : score >= 40 ? "var(--yellow)" : "var(--red)";
  return (
    <div className={styles.scoreBadge} title={nFactors != null ? `Based on ${nFactors} of 9 factors` : undefined}>
      <span className={styles.scoreNum} style={{ color }}>{score}</span>
      <span className={styles.scoreLabel} style={{ color }}>{label}</span>
    </div>
  );
}

function SignalCard({ name, score, detail, interp }) {
  const color = score === 1 ? "var(--accent)" : score === -1 ? "var(--red)" : "var(--muted)";
  const icon  = score === 1 ? "▲" : score === -1 ? "▼" : "—";
  const cls   = score === 1 ? styles.sigUp : score === -1 ? styles.sigDown : "";
  return (
    <div className={`${styles.signalCard} ${cls}`}>
      <div className={styles.sigHeader}>
        <span className={styles.sigName}>{name}</span>
        <span className={styles.sigIcon} style={{ color }}>{icon}</span>
      </div>
      <div className={styles.sigDetail}>{detail ?? "—"}</div>
      <div className={styles.sigInterp}>{interp}</div>
    </div>
  );
}

function RangeBar({ price, low, high }) {
  if (price == null || low == null || high == null || high === low) return null;
  const pct = Math.max(0, Math.min(100, Math.round((price - low) / (high - low) * 100)));
  return (
    <div className={styles.rangeWrap}>
      <div className={styles.rangeBar}>
        <div className={styles.rangeFill} style={{ width: `${pct}%` }} />
        <div className={styles.rangeThumb} style={{ left: `${pct}%` }} />
      </div>
      <div className={styles.rangeLabels}>
        <span>52W Low {fmt(low)}</span>
        <span className={styles.rangeCurrent}>{fmt(price)} · {pct}% of range</span>
        <span>52W High {fmt(high)}</span>
      </div>
    </div>
  );
}

function FundCell({ label, value, color }) {
  return (
    <div className={styles.fundCell}>
      <span className={styles.fundLabel}>{label}</span>
      <span className={styles.fundValue} style={color ? { color } : {}}>{value ?? "—"}</span>
    </div>
  );
}

function NewsItem({ item }) {
  return (
    <a className={styles.newsCard} href={item.url} target="_blank" rel="noopener noreferrer">
      <div className={styles.newsTitle}>{item.title}</div>
      <div className={styles.newsMeta}>{item.publisher} · {item.date}</div>
      {item.summary && <div className={styles.newsSummary}>{item.summary}</div>}
    </a>
  );
}

export default function Analyse() {
  const [query,   setQuery]   = useState("");
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const inputRef = useRef(null);

  const run = async () => {
    const ticker = query.trim().toUpperCase();
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res  = await fetch(`${API}/api/analyse?ticker=${encodeURIComponent(ticker)}`);
      const data = await res.json();
      if (data.error) setError(data.error);
      else            setResult(data);
    } catch {
      setError("Could not reach the backend.");
    } finally {
      setLoading(false);
    }
  };

  const s = result?.signals      ?? {};
  const f = result?.fundamentals ?? {};
  const t = result?.technicals   ?? {};

  const signPct = v => v != null ? `${v > 0 ? "+" : ""}${v}%` : null;

  return (
    <div className={styles.wrap}>
      {/* Search */}
      <div className={styles.searchRow}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="NSE ticker — RELIANCE, TCS, INFY, HDFCBANK…"
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && run()}
          spellCheck={false}
        />
        <button className={styles.searchBtn} onClick={run} disabled={loading}>
          {loading ? "Analysing…" : "Analyse"}
        </button>
      </div>

      {loading && (
        <div className={styles.center}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Fetching data for {query}…</p>
        </div>
      )}

      {error && !loading && (
        <div className={styles.errorBox}>
          <span className={styles.errorIcon}>✕</span>
          <span>{error}</span>
        </div>
      )}

      {result && !loading && (
        <div className={styles.results}>

          {/* Overview */}
          <div className={styles.overview}>
            <div>
              <div className={styles.overviewTicker}>
                {result.ticker}
                <a
                  href={`https://www.tradingview.com/chart/?symbol=NSE:${result.ticker}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.tvLink}
                >TradingView ↗</a>
              </div>
              <div className={styles.overviewCompany}>{result.company}</div>
              <div className={styles.overviewMeta}>{result.sector} · NSE</div>
            </div>
            <div className={styles.overviewRight}>
              <div className={styles.overviewPrice}>{fmt(result.price)}</div>
              <div className={styles.scoreBadgeRow}>
                <ScoreBadge score={result.score} />
                <FundamentalScoreBadge score={f.fundamental_score} nFactors={f.fundamental_score_factors} />
              </div>
            </div>
          </div>

          {/* Signal Cards */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>TECHNICAL SIGNALS</div>
            {result.score_basis && <p className={styles.scoreBasis}>{result.score_basis}</p>}
            <div className={styles.signalGrid}>
              <SignalCard
                name="TREND"
                score={s.trend?.score}
                detail={s.trend?.sma50 ? `50D ₹${s.trend.sma50} · 200D ₹${s.trend.sma200}` : null}
                interp={s.trend?.score === 1 ? "Above both moving averages" : s.trend?.score === -1 ? "Below key moving averages" : "Mixed trend"}
              />
              <SignalCard
                name="MOMENTUM"
                score={s.momentum?.score}
                detail={s.momentum?.rsi != null ? `RSI ${s.momentum.rsi}` : null}
                interp={s.momentum?.score === 1 ? "Healthy zone · not overbought" : s.momentum?.score === -1 ? "Overbought or momentum broken" : "Neutral RSI"}
              />
              <SignalCard
                name="VOLUME"
                score={s.volume?.score}
                detail={s.volume?.vol_ratio != null ? `${s.volume.vol_ratio}× 20-day avg` : null}
                interp={s.volume?.score === 1 ? "Strong buying conviction" : s.volume?.score === -1 ? "Low participation" : "Average volume"}
              />
              <SignalCard
                name="BREAKOUT"
                score={s.breakout?.score}
                detail={s.breakout?.pct_from_high != null ? `${s.breakout.pct_from_high}% from 52W high` : null}
                interp={s.breakout?.score === 1 ? "In 52W high breakout zone" : s.breakout?.score === -1 ? "Deep off highs" : "Mid-range"}
              />
              <SignalCard
                name="REL STRENGTH"
                score={s.rel_strength?.score}
                detail={s.rel_strength?.rel_strength != null ? `${s.rel_strength.rel_strength > 0 ? "+" : ""}${s.rel_strength.rel_strength}% vs Nifty (1M)` : null}
                interp={s.rel_strength?.score === 1 ? "Outperforming the market" : s.rel_strength?.score === -1 ? "Lagging the market" : "Inline with Nifty"}
              />
            </div>
          </section>

          {/* Trade Setup */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>TRADE SETUP</div>
            <div className={styles.tradeCard}>
              <div className={styles.tradeCell}>
                <span className={styles.tradeLbl}>Entry (CMP)</span>
                <span className={styles.tradeVal}>{fmt(result.price)}</span>
              </div>
              <div className={styles.tradeDivider} />
              <div className={styles.tradeCell}>
                <span className={styles.tradeLbl}>Stop Loss</span>
                <span className={styles.tradeVal} style={{ color: "var(--red)" }}>{fmt(result.stop_loss)}</span>
                <span className={styles.tradeSub}>-{result.stop_pct}%</span>
              </div>
              <div className={styles.tradeDivider} />
              <div className={styles.tradeCell}>
                <span className={styles.tradeLbl}>Target</span>
                <span className={styles.tradeVal} style={{ color: "var(--accent)" }}>{fmt(result.target)}</span>
                <span className={styles.tradeSub}>+{result.target_pct}%</span>
              </div>
              <div className={styles.tradeDivider} />
              <div className={styles.tradeCell}>
                <span className={styles.tradeLbl}>Risk / Reward</span>
                <span className={styles.tradeVal} style={{ color: "var(--accent)" }}>1:{result.rr_ratio}</span>
                {result.target_days_est && <span className={styles.tradeSub}>~{result.target_days_est} days</span>}
              </div>
            </div>
          </section>

          {/* 52W Range + MAs */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>PRICE RANGE & MOVING AVERAGES</div>
            <div className={styles.rangeSection}>
              <RangeBar price={result.price} low={t["52w_low"]} high={t["52w_high"]} />
              <div className={styles.maRow}>
                {t.sma_20  != null && <span className={styles.maPill}><span className={styles.maLbl}>SMA 20</span> {fmt(t.sma_20)}</span>}
                {t.sma_50  != null && <span className={styles.maPill}><span className={styles.maLbl}>SMA 50</span> {fmt(t.sma_50)}</span>}
                {t.sma_200 != null && <span className={styles.maPill}><span className={styles.maLbl}>SMA 200</span> {fmt(t.sma_200)}</span>}
                {t.atr_pct != null && <span className={styles.maPill}><span className={styles.maLbl}>ATR</span> {t.atr_pct}%</span>}
              </div>
            </div>
          </section>

          {/* Fundamentals */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>FUNDAMENTALS</div>
            <div className={styles.fundGrid}>
              <FundCell label="Market Cap"     value={fmtCap(f.market_cap_cr)} />
              <FundCell label="P/E (TTM)"      value={f.pe} />
              <FundCell label="P/E (Forward)"  value={f.pe_fwd} />
              <FundCell label="EPS"            value={f.eps != null ? `₹${f.eps}` : null} />
              <FundCell label="Rev Growth"
                value={f.rev_growth != null ? signPct(f.rev_growth) : null}
                color={f.rev_growth > 0 ? "var(--accent)" : f.rev_growth < 0 ? "var(--red)" : null} />
              <FundCell label="Earnings Growth"
                value={f.earnings_growth != null ? signPct(f.earnings_growth) : null}
                color={f.earnings_growth > 15 ? "var(--accent)" : f.earnings_growth < 0 ? "var(--red)" : null} />
              <FundCell label="Profit Margin"
                value={f.profit_margin != null ? `${f.profit_margin}%` : null}
                color={f.profit_margin > 15 ? "var(--accent)" : f.profit_margin < 5 ? "var(--red)" : null} />
              <FundCell label="Gross Margin"   value={f.gross_margin != null ? `${f.gross_margin}%` : null} />
              <FundCell label="Oper. Margin"   value={f.operating_margin != null ? `${f.operating_margin}%` : null} />
              <FundCell label="ROE"
                value={f.roe != null ? `${f.roe}%` : null}
                color={f.roe > 15 ? "var(--accent)" : f.roe < 8 ? "var(--red)" : null} />
              <FundCell label="Debt / Equity"
                value={f.debt_to_equity}
                color={f.debt_to_equity != null && f.debt_to_equity < 0.5 ? "var(--accent)" : f.debt_to_equity > 2 ? "var(--red)" : null} />
              <FundCell label="Current Ratio"
                value={f.current_ratio}
                color={f.current_ratio != null && f.current_ratio > 1.5 ? "var(--accent)" : f.current_ratio < 1 ? "var(--red)" : null} />
              <FundCell label="Price / Book"   value={f.price_to_book} />
              <FundCell label="ROA"            value={f.roa != null ? `${f.roa}%` : null} />
              <FundCell label="Dividend Yield" value={f.dividend_yield != null ? `${f.dividend_yield}%` : null} />
              <FundCell label="Sector"         value={result.sector} />
            </div>
            {f.summary && <p className={styles.fundSummary}>{f.summary}</p>}
          </section>

          {/* Analyst Note */}
          {result.valuation?.summary && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>VALUATION CASE</div>
              <p className={styles.rationale}>{result.valuation.summary}</p>
            </section>
          )}

          {result.rationale && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>ANALYST NOTE</div>
              <p className={styles.rationale}>{result.rationale}</p>
            </section>
          )}

          {/* News */}
          {result.news?.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>
                NEWS
                <span className={`${styles.sentBadge} ${
                  result.news_sentiment === 1  ? styles.sentPos :
                  result.news_sentiment === -1 ? styles.sentNeg :
                  styles.sentNeu
                }`}>
                  {result.news_sentiment === 1 ? "POSITIVE" : result.news_sentiment === -1 ? "NEGATIVE" : "NEUTRAL"}
                </span>
              </div>
              <div className={styles.newsList}>
                {result.news.map((item, i) => <NewsItem key={i} item={item} />)}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
