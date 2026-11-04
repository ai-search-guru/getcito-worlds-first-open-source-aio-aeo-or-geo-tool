'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { IntegrationProvider, IntegrationStatus } from '@/lib/actions/integrations';
import {
  readIntegrationStatus,
  startIntegrationConnect,
  type IntegrationFailure,
} from '@/lib/integrationsClient';

/** How long the popup flow waits for Composio to report the account (#577). */
const CONNECT_DEADLINE_MS = 120_000;
const CONNECT_POLL_MS = 3000;

/** What a Connect that couldn't start says (a read-only workspace opens the upgrade dialog). */
const CONNECT_ERRORS = {
  timeout: 'integrations_connectTimedOut',
  forbidden: 'integrations_connectForbidden',
  failed: 'integrations_connectFailed',
} as const satisfies Record<Exclude<IntegrationFailure, 'subscription'>, string>;

/**
 * Connect a Google integration in an OAuth popup, polling until Composio
 * reports the account connected. Shared by Settings › Integrations and AI
 * Traffic's data sources strip, so the user connects from where they are
 * and never leaves the page. A blocked popup falls back to the same tab,
 * and `callbackUrl` is where Composio sends them back.
 *
 * `onStatus` hears the outcome: 'connected', or whatever the final check
 * said once the user closed the popup. An unmounted caller stops polling.
 * On a read-only workspace (plan not active) `connect` opens the upgrade
 * dialog instead. The calls go from the browser (lib/integrationsClient.ts),
 * so Connect never waits behind a page's server actions, and one that can't
 * start says why.
 */
export function useIntegrationConnect(
  provider: IntegrationProvider,
  {
    label,
    callbackUrl,
    onStatus,
  }: {
    label: string;
    callbackUrl: () => string;
    onStatus: (status: IntegrationStatus) => void;
  },
) {
  const [connecting, setConnecting] = useState(false);
  const { guard, openUpgrade } = useUpgradeGate();
  const t = useTranslations('settings');
  const tActions = useTranslations('readOnly.actions');
  // Bumped to stop a poll: a newer attempt, or the caller unmounting.
  const pollGen = useRef(0);

  useEffect(() => {
    const gens = pollGen;
    return () => {
      gens.current++;
    };
  }, []);

  const connect = async () => {
    setConnecting(true);
    const gen = ++pollGen.current;
    try {
      const started = await startIntegrationConnect(provider, callbackUrl());
      if (!started.ok) {
        if (started.reason === 'subscription') openUpgrade();
        else toast.error(t(CONNECT_ERRORS[started.reason], { label }));
        return;
      }
      const redirectUrl = started.value;

      const popup = window.open(redirectUrl, `${provider}-oauth`, 'width=560,height=720');
      if (!popup) {
        // Popup blocked — same-tab fallback; status resolves on return.
        window.location.href = redirectUrl;
        return;
      }

      const deadline = Date.now() + CONNECT_DEADLINE_MS;
      while (Date.now() < deadline && pollGen.current === gen) {
        await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
        if (pollGen.current !== gen) return;
        // A read that fails is transient: keep polling until the deadline.
        const result = await readIntegrationStatus(provider);
        if (result.ok && result.value === 'connected') {
          onStatus('connected');
          toast.success(`${label} connected`);
          popup.close();
          return;
        }
        if (popup.closed) {
          // User closed the window — one final check, then give up quietly.
          const final = await readIntegrationStatus(provider);
          if (pollGen.current !== gen) return;
          const status = final.ok ? final.value : 'not_connected';
          onStatus(status);
          if (status === 'connected') {
            toast.success(`${label} connected`);
          }
          return;
        }
      }
      if (pollGen.current === gen) {
        toast.error('Connection timed out — try again.');
      }
    } catch (err) {
      console.error(`Failed to connect ${provider}:`, err);
      toast.error(t('integrations_connectFailed', { label }));
    } finally {
      if (pollGen.current === gen) setConnecting(false);
    }
  };

  return { connecting, connect: guard(connect, { action: tActions('connectIntegrations') }) };
}
