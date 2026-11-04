-- Starter tracks ChatGPT and Microsoft Copilot, no longer ChatGPT and
-- Perplexity.
--
-- The plan's engine list lives in config/plans (web and server), and new or
-- edited prompts follow it. The tracking worker, though, runs each prompt's
-- stored `platforms`, so prompts saved under the old list would keep running
-- Perplexity and never get Copilot. This swaps the engine on the prompts of
-- every organization on the Starter plan, as alignPromptsToPlanForOrg does on
-- a plan change. Past Perplexity results stay as they are.
--
-- Only cloud organizations are touched: a Stripe customer exists only there.
-- Self-hosted installs run every engine, whatever `plan` holds.

update public.prompts p
set platforms = case
      -- Already tracking Copilot: drop Perplexity rather than list Copilot twice.
      when 'copilot-web' = any (p.platforms) then array_remove(p.platforms, 'perplexity-web')
      else array_replace(p.platforms, 'perplexity-web', 'copilot-web')
    end
from public.prompt_sets ps
join public.brands b on b.id = ps.brand_id
join public.organizations o on o.id = b.organization_id
where p.prompt_set_id = ps.id
  and o.plan = 'starter'
  and o.stripe_customer_id is not null
  and 'perplexity-web' = any (p.platforms);
