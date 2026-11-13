import { test } from "node:test";
import assert from "node:assert/strict";
import { effectivePhase, leaderboard, pickWinners, publicState, scoreAnswer, type BattleDoc } from "../lib/game.ts";
import { cleanQuestions, offlineQuiz } from "../lib/quiz.ts";

const doc = (over: Partial<BattleDoc> = {}): BattleDoc => ({
  code: "ABC123", title: "T", sponsorName: "S", createdAt: 0, hostKeyHash: "x",
  quiz: { salt: "s", questions: [{ q: "Q?", options: ["a", "b", "c", "d"], answer: 2 }] },
  quizCommit: "c", secondsPerQuestion: 20, chain: null, phase: "question", qIndex: 0, qStartedAt: 1000, ...over,
});

test("faster correct answers score more; wrong answers score zero", () => {
  assert.equal(scoreAnswer(false, 10, 20000), 0);
  assert.equal(scoreAnswer(true, 0, 20000), 1000);
  assert.equal(scoreAnswer(true, 20000, 20000), 500);
  assert.ok(scoreAnswer(true, 2000, 20000) > scoreAnswer(true, 9000, 20000));
});

test("question closes when time is up or everyone has answered", () => {
  const d = doc();
  assert.equal(effectivePhase(d, 0, 3, 5000), "question");
  assert.equal(effectivePhase(d, 3, 3, 5000), "reveal");
  assert.equal(effectivePhase(d, 1, 3, 1000 + 20000), "reveal");
});

test("ties go to the faster player, zero scorers never win", () => {
  const players = [
    { wallet: "A", name: "A", token: "", joinedAt: 1 },
    { wallet: "B", name: "B", token: "", joinedAt: 2 },
    { wallet: "C", name: "C", token: "", joinedAt: 3 },
  ];
  const answers = [
    { wallet: "A", qi: 0, choice: 1, ms: 5000, correct: true, points: 800 },
    { wallet: "B", qi: 0, choice: 1, ms: 3000, correct: true, points: 800 },
    { wallet: "C", qi: 0, choice: 0, ms: 1000, correct: false, points: 0 },
  ];
  const board = leaderboard(players, answers);
  assert.deepEqual(board.map((b) => b.wallet), ["B", "A", "C"]);
  assert.deepEqual(pickWinners(board, 3).map((w) => w.wallet), ["B", "A"]);
});

test("answer key stays hidden until the reveal", () => {
  const live = publicState(doc(), [], [], 2000);
  assert.equal(live.question?.answer, undefined);
  assert.equal(live.revealedQuiz, undefined);
  const shown = publicState(doc(), [], [], 1000 + 21000);
  assert.equal(shown.question?.answer, 2);
  const done = publicState(doc({ phase: "finished" }), [], [], 0);
  assert.ok(done.revealedQuiz);
});

test("model output is validated and options are reshuffled", () => {
  const qs = cleanQuestions({ questions: [
    { q: "ok?", options: ["w", "x", "y", "z"], answer: 0 },
    { q: "bad", options: ["only", "three", "opts"], answer: 0 },
    { q: "dup", options: ["a", "a", "b", "c"], answer: 0 },
  ] }, 10);
  assert.equal(qs.length, 1);
  assert.equal(qs[0].options[qs[0].answer], "w");
});

test("offline generator builds valid questions from notes", () => {
  const notes = `A closed-loop control system uses feedback from the measured output. The proportional term reacts to the current error in a controller. The integral term removes steady-state error over time in the controller. The derivative term adds damping and reduces overshoot in the response. A stepper motor moves in discrete steps for precise positioning in printers. A servo motor uses an encoder to hold an exact position under load.`;
  const qs = offlineQuiz(notes, 4);
  assert.ok(qs.length >= 2);
  for (const q of qs) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.q.includes("_____"));
  }
});
