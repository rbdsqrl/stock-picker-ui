import { useState } from "react";
import TodayPick from "./TodayPick";
import History from "./History";
import Analyse from "./Analyse";
import Archive from "./Archive";
import styles from "./App.module.css";

export default function App() {
  const [view, setView] = useState("today");

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <svg className={styles.logoMark} width="22" height="20" viewBox="0 0 22 20" fill="none" aria-hidden="true">
            <polyline points="1,18 8,10 14,5 20,1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="20" cy="1" r="2.5" fill="currentColor"/>
          </svg>
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
            className={`${styles.navBtn} ${view === "analyse" ? styles.active : ""}`}
            onClick={() => setView("analyse")}
          >Analyse</button>
          <button
            className={`${styles.navBtn} ${view === "archive" ? styles.active : ""}`}
            onClick={() => setView("archive")}
          >Archive</button>
        </nav>
      </header>

      <main className={styles.main}>
        {view === "today"   && <TodayPick />}
        {view === "history" && <History />}
        {view === "analyse" && <Analyse />}
        {view === "archive" && <Archive />}
      </main>

      <footer className={styles.footer}>
        <span>For research only. Not financial advice.</span>
        <span className={styles.time}>{new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "short", day: "numeric" })}</span>
      </footer>
    </div>
  );
}
