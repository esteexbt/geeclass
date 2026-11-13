"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Bubble, Footer, Header, LETTERS } from "@/components/ui";

const SAMPLE = {
  q: "In a closed-loop control system, what is fed back to the controller?",
  options: ["The reference input", "The measured output", "The disturbance", "The actuator power"],
  answer: 1,
};

function SampleQuestion() {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  return (
    <div className="sheet demo-sheet">
      <div className="sheet-head">
        <span>MCE 307 battle · Q4 of 10</span>
        <span>{done ? (picked === SAMPLE.answer ? "+870 pts" : "0 pts") : "Try it"}</span>
      </div>
      <p className="q">{SAMPLE.q}</p>
      <div className="stack mt-2">
        {SAMPLE.options.map((o, i) => {
          const state = !done
            ? "empty"
            : i === SAMPLE.answer
              ? "correct"
              : i === picked
                ? "wrong"
                : "empty";
          return (
            <button
              key={o}
              className={`option ${done && i === SAMPLE.answer ? "is-correct" : ""} ${done && i === picked && i !== SAMPLE.answer ? "is-wrong" : ""}`}
              onClick={() => setPicked(i)}
              disabled={done}
            >
              <Bubble letter={LETTERS[i]} state={state} />
              {o}
            </button>
          );
        })}
      </div>
      {done && (
        <p className="mt-2 small">
          {picked === SAMPLE.answer ? "Correct, and fast. " : "Not this time. "}
          In a real battle, the top three split a prize that was locked on Solana before the first question.{" "}
          <button className="linkish" onClick={() => setPicked(null)}>Try again</button>
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <>
      <Header />
      <main>
        <section className="hero wrap">
          <div className="grid-2">
            <div>
              <h1>Your notes. Your coursemates. A real prize.</h1>
              <p className="lede">
                Drop in lecture notes and GeeClass turns them into a live quiz battle. A lecturer, class rep or brand
                puts up the prize, it gets locked on Solana before anyone plays, and the top three are paid the moment
                the last question ends.
              </p>
              <div className="hero-actions">
                <Link href="/host" className="btn">Host a battle</Link>
                <form
                  className="join-box"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (code.trim().length >= 4) router.push(`/b/${code.trim().toUpperCase()}`);
                  }}
                >
                  <label className="sr" htmlFor="code">Battle code</label>
                  <input
                    id="code"
                    className="input"
                    placeholder="CODE"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                  />
                  <button className="btn ghost" type="submit">Join</button>
                </form>
              </div>
            </div>
            <SampleQuestion />
          </div>
        </section>

        <section className="how wrap">
          <h2>How a battle runs</h2>
          <div className="how-grid">
            <div className="how-step">
              <Bubble letter="1" state="shaded" size={38} />
              <div>
                <h3>Sponsor locks the prize</h3>
                <p className="muted">
                  Paste course material, review the AI questions, set the prize and split. One wallet signature moves the
                  money into a vault no one can touch, including us.
                </p>
              </div>
            </div>
            <div className="how-step">
              <Bubble letter="2" state="shaded" size={38} />
              <div>
                <h3>Students battle live</h3>
                <p className="muted">
                  Everyone joins with a code. A voice host reads each question, answers are timed, and faster correct
                  answers score more.
                </p>
              </div>
            </div>
            <div className="how-step">
              <Bubble letter="3" state="shaded" size={38} />
              <div>
                <h3>Winners get paid instantly</h3>
                <p className="muted">
                  The program checks every winner really played, pays them in one transaction, and returns anything
                  unclaimed to the sponsor.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="who wrap">
          <div>
            <h3>For lecturers and class reps</h3>
            <p className="muted">
              Get the whole class revising the week before a test. Fund a pool with a few dollars and watch attendance
              at revision jump.
            </p>
          </div>
          <div>
            <h3>For brands and student bodies</h3>
            <p className="muted">
              Sponsor a battle instead of a flyer. Every player sees your name, and the payout is public proof you
              delivered what you promised.
            </p>
          </div>
          <div>
            <h3>Nobody can rig it</h3>
            <p className="muted">
              The quiz is fingerprinted onchain before it starts, so questions can&apos;t be swapped mid-battle. After
              the battle, anyone can check the fingerprint and the final scoreboard.
            </p>
          </div>
          <div>
            <h3>Nobody can run with the money</h3>
            <p className="muted">
              If the host never pays out, the sponsor gets every cent back after the deadline. The program has no other
              way for funds to leave.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
