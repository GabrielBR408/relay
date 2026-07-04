# Relay

Walkie-talkie + transcription group messaging. One shared channel timeline; each member
consumes it their way — **audio mode** (incoming voice auto-plays, walkie-talkie style) or
**text mode** (silent; voice arrives as transcripts).

**Live test copy:** https://gabrielbr408.github.io/relay/

## Stack
- Frontend: React + Vite PWA, deployed to GitHub Pages
- Backend: Supabase (`relay`, ref `lvoqrfxenkilouctdtin`) — Postgres, Auth (email+password,
  autoconfirm on), Realtime, Storage (`clips` bucket, public)
- Transcription: Web Speech API live during recording (Chrome/Android/Edge); server-side
  fallback via `transcribe` edge function — uses OpenAI Whisper when an `OPENAI_API_KEY`
  secret is set on the Supabase project, otherwise posts a clearly-labeled stub
- TTS for text messages: Web Speech synthesis

## How to test
1. Open the link on two devices/browsers (or one normal + one incognito window).
2. Sign up two accounts (e.g. `you+a@gmail.com` / `you+b@gmail.com` — any password 6+ chars;
   no email confirmation needed).
3. Device A: **＋** → create a channel. The invite code is shown in the channel row and
   thread header (tap header to copy).
4. Device B: **＋** → enter the invite code → Join.
5. Hold the 🎙 button to talk, release to send. Tap **Aa** on a voice bubble to toggle its
   transcript.
6. Header toggles: 🔊 audio mode (auto-plays incoming voice) / 💬 text mode (silent,
   transcripts shown) / 🗣 TTS (reads incoming text aloud, audio mode only).

## Local dev
```
npm install
npm run dev
```
Env in `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Deploy
```
npm run build
# push dist/ to gh-pages branch
```
Supabase changes: `supabase db push` (migrations in `supabase/migrations/`),
`supabase functions deploy transcribe`.
