-- Give the server's background work more than eight seconds.
--
-- service_role had no statement_timeout of its own, so over PostgREST it
-- inherited authenticator's 8s — the same cap as a user's page load. Code
-- that assumed the service role runs unbounded was wrong: on the largest
-- brand, refresh_insights_daily timed out both in the nightly sweep and when
-- its run stamped, every day, so that brand's current day never reached the
-- Insights rollups. Pulse, signal and report work runs under the same cap.
--
-- Background jobs get two minutes. User-facing requests keep their limits:
-- authenticated stays at 8s and anon at 3s.

alter role service_role set statement_timeout = '120s';

-- PostgREST reads per-role settings when it loads its config; make it pick
-- this one up without a restart.
notify pgrst, 'reload config';
