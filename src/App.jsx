import { useState } from "react";
import TodayPick from "./TodayPick";
import History from "./History";
import Watchlist from "./Watchlist";
import Analyse from "./Analyse";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState("today");

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>▲</span>
          <span className={styles.logoText}>STOCKPICK</span>
          <span className={styles.logoBadge}>AI</span>
        </div>
        <nav className={styles.nav}>
          <button
            className={`${styles.navBtn} ${view === "today" ? styles.active : ""}`}
            onClick={() => setView("today")}
          >Today</button>
          <button
            className={`${styles.navBtn} ${view === "history" ? styles.active : ""}`}
            onClick={() => setView("history")}
          >History</button>
          <button
            className={`${styles.navBtn} ${view === "watchlist" ? styles.activeAmber : ""}`}
            onClick={() => setView("watchlist")}
          >Setting Up</button>
          <button
            className={`${styles.navBtn} ${view === "analyse" ? styles.active : ""}`}
            onClick={() => setView("analyse")}
          >Analyse</button>
        </nav>
      </header>

      <main className={styles.main}>
        {view === "today"     && <TodayPick />}
        {view === "history"   && <History />}
        {view === "watchlist" && <Watchlist />}
        {view === "analyse"   && <Analyse />}
      </main>

      <footer className={styles.footer}>
        <span>For research only. Not financial advice.</span>
        <span className={styles.time}>{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "short", day: "numeric" })}</span>
      </footer>
    </div>
  );
}
