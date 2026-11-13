// Voice host. Uses ElevenLabs when a key is set; otherwise tells the client to use the browser voice.
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response(null, { status: 204 });
  let text = "";
  try {
    text = String((await req.json())?.text ?? "").slice(0, 600);
  } catch {}
  if (!text) return new Response(null, { status: 204 });

  const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45 },
    }),
  });
  if (!res.ok || !res.body) {
    console.error("[voice] ElevenLabs failed", res.status, await res.text().catch(() => ""));
    return new Response(null, { status: 204 });
  }
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
