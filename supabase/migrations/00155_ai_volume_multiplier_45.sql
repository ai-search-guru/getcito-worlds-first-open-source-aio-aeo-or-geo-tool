-- The AI adoption rate's default goes from 15% to 45% of a prompt's Google
-- volume.
--
-- est_ai_volume is the prompt's Google volume (the median of its keywords',
-- 00154) times the AI adoption rate, AI_VOLUME_MULTIPLIER on the server.
-- Its default was 15%, about the share of Google searches that showed an AI
-- Overview a year ago; they now appear on roughly 43–48%
-- (backend/src/lib/intentExtraction.js). This moves the rows stored at the
-- old default to the new one. Rows saved under any other rate were set on
-- purpose by the install, and are left alone.
--
-- An install that sets AI_VOLUME_MULTIPLIER=0.15 itself (backend/.env.example
-- did) keeps analyzing at 15% until it is changed to 0.45 or removed.

update public.prompt_volumes
set ai_volume_multiplier = 0.450,
    est_ai_volume = round(total_google_volume * 0.450)::integer
where ai_volume_multiplier = 0.150;
