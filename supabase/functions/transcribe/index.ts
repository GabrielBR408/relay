// Transcribe an audio message clip.
// Real transcription via OpenAI Whisper when OPENAI_API_KEY is set;
// otherwise writes a clearly-labeled stub so the pipeline stays testable.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let messageId: string | undefined;
  try {
    const body = await req.json();
    messageId = body.message_id;
  } catch {
    // fall through
  }
  if (!messageId) {
    return json({ error: "message_id required" }, 400);
  }

  const { data: msg, error: msgErr } = await admin
    .from("messages")
    .select("id, audio_path, duration_ms, transcript_status")
    .eq("id", messageId)
    .single();

  if (msgErr || !msg || !msg.audio_path) {
    return json({ error: "message not found or has no audio" }, 404);
  }

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let transcript: string;

    if (apiKey) {
      const { data: blob, error: dlErr } = await admin.storage
        .from("clips")
        .download(msg.audio_path);
      if (dlErr || !blob) throw new Error("audio download failed");

      const form = new FormData();
      form.append("file", blob, "clip.webm");
      form.append("model", "whisper-1");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) throw new Error(`whisper ${res.status}: ${await res.text()}`);
      const out = await res.json();
      transcript = (out.text ?? "").trim() || "(no speech detected)";
    } else {
      const secs = msg.duration_ms ? Math.round(msg.duration_ms / 1000) : 0;
      transcript =
        `[Stub transcript — server-side transcription needs an OPENAI_API_KEY secret. ` +
        `Voice clip, ~${secs}s.]`;
    }

    await admin
      .from("messages")
      .update({ transcript, transcript_status: "done" })
      .eq("id", messageId);

    return json({ ok: true, transcript });
  } catch (e) {
    await admin
      .from("messages")
      .update({ transcript_status: "failed" })
      .eq("id", messageId);
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
