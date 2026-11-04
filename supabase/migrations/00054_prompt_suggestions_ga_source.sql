-- Google Analytics as a prompt-suggestion source (#705).
--
-- The check constraint predates the Analytics pipeline; without 'ga' the
-- suggestion insert fails outright rather than degrading, so this has to land
-- with the generator that produces those rows.
ALTER TABLE public.prompt_suggestions DROP CONSTRAINT prompt_suggestions_source_check;
ALTER TABLE public.prompt_suggestions ADD CONSTRAINT prompt_suggestions_source_check
    CHECK (source = ANY (ARRAY['llm'::text, 'heuristic'::text, 'gsc'::text, 'ga'::text]));
