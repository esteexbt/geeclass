"use client";
import { useCallback, useRef, useState } from "react";

/** The voice host: ElevenLabs through /api/voice, falling back to the browser's own voice. */
export function useVoice() {
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const premium = useRef<boolean | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const browserSay = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.04;
    u.pitch = 1;
    const voices = synth.getVoices();
    const v =
      voices.find((x) => /en-NG/i.test(x.lang)) ||
      voices.find((x) => /en-GB/i.test(x.lang) && /Google|Natural/i.test(x.name)) ||
      voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }, []);

  const say = useCallback(
    async (text: string) => {
      if (!enabled || !text) return;
      stop();
      if (premium.current !== false) {
        try {
          const res = await fetch("/api/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (res.status === 200) {
            premium.current = true;
            const url = URL.createObjectURL(await res.blob());
            const a = audio.current ?? new Audio();
            audio.current = a;
            a.src = url;
            a.onended = () => {
              setSpeaking(false);
              URL.revokeObjectURL(url);
            };
            setSpeaking(true);
            await a.play();
            return;
          }
          premium.current = false;
        } catch {
          premium.current = false;
        }
      }
      browserSay(text);
    },
    [enabled, stop, browserSay],
  );

  /** Call from a click so browsers allow audio for the rest of the session. */
  const unlock = useCallback(() => {
    const a = audio.current ?? new Audio();
    audio.current = a;
    a.muted = true;
    a.play().catch(() => {}).finally(() => (a.muted = false));
    window.speechSynthesis?.getVoices();
  }, []);

  return { say, stop, unlock, enabled, setEnabled, speaking };
}
