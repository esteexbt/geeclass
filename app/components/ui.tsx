"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import WalletButton from "./WalletButton";

export const LETTERS = ["A", "B", "C", "D"];

export function Bubble({
  letter,
  state = "empty",
  size,
}: {
  letter: string;
  state?: "empty" | "shaded" | "correct" | "wrong";
  size?: number;
}) {
  return (
    <span
      className={`bubble ${state === "empty" ? "" : state}`}
      style={size ? ({ "--size": `${size}px` } as React.CSSProperties) : undefined}
      aria-hidden
    >
      <i className="fill" />
      <span>{letter}</span>
    </span>
  );
}

export function Logo() {
  return (
    <Link href="/" className="brand" aria-label="GeeClass home">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="24" fill="none" stroke="#D9415E" strokeWidth="5" />
        <circle cx="32" cy="32" r="15" fill="currentColor" />
        <circle cx="49" cy="15" r="7" fill="#F5E142" stroke="currentColor" strokeWidth="3" />
      </svg>
      <span className="brand-name">GeeClass</span>
    </Link>
  );
}

export function Header({ dark = false, right }: { dark?: boolean; right?: ReactNode }) {
  return (
    <header className={dark ? "stage-top" : "topbar"}>
      <div className="wrap spread">
        <Logo />
        <nav className="nav">
          {right ?? (
            <>
              <Link href="/host" className="hide-sm">Host a battle</Link>
              <Link href="/faucet" className="hide-sm">Faucet</Link>
            </>
          )}
          <WalletButton />
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap spread">
        <span>GeeClass runs on Solana devnet. Prize pools are held by an open-source program, not by us.</span>
        <a href="https://github.com/esteexbt/geeclass">Source code</a>
      </div>
    </footer>
  );
}
