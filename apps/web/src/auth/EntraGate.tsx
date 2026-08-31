/**
 * Sign-in, when the build is configured for it.
 *
 * In stub mode this renders its children and nothing else — no MSAL instance is created,
 * no token function is installed, and the app behaves exactly as it did before Entra
 * existed. That is the whole reason the gate is a separate component from
 * `AuthProvider`: identity resolution (`/api/auth/me`, ADR-0039) is unchanged by *how* the
 * request was authenticated, and putting sign-in inside it would have entangled the two.
 *
 * What this owns: obtaining a token and putting a signed-in account in place. Who that
 * account *is* in this product, and what they may do, still comes from the server
 * (ADR-0058) — the token is a credential, not a source of identity.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { setAccessTokenProvider } from '../api/client.ts';
import { apiTokenRequest, isEntraMode } from './entraConfig.ts';
import { acquireApiToken, getMsalInstance } from './msalInstance.ts';

type Phase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'failed'; readonly message: string };

export function EntraGate({ children }: { readonly children: ReactNode }) {
  if (!isEntraMode) return <>{children}</>;
  return <EntraSignIn>{children}</EntraSignIn>;
}

function EntraSignIn({ children }: { readonly children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const pca = await getMsalInstance();
        if (cancelled) return;

        // Installed before the first render that can issue a request, so no query ever
        // goes out unauthenticated and comes back 401 for want of a header we had.
        setAccessTokenProvider(acquireApiToken);

        if (pca.getActiveAccount()) {
          setPhase({ kind: 'signed-in' });
          return;
        }

        // Not signed in and no interaction has been asked for yet. `ssoSilent` would be
        // the polite next step, but it needs a login hint we do not have on a first
        // visit, so the honest thing is to show a button and let the person press it.
        setPhase({ kind: 'signed-out' });
      } catch (error) {
        if (cancelled) return;
        setPhase({ kind: 'failed', message: describe(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (phase.kind === 'signed-in') return <>{children}</>;

  return (
    <SignInScreen
      phase={phase}
      onSignIn={async () => {
        try {
          const pca = await getMsalInstance();
          // Redirect, not popup: a popup is blocked by default in several of the managed
          // browser configurations this will run under, and a blocked popup fails
          // silently — the button appears to do nothing.
          await pca.loginRedirect(apiTokenRequest());
        } catch (error) {
          setPhase({ kind: 'failed', message: describe(error) });
        }
      }}
    />
  );
}

function SignInScreen({
  phase,
  onSignIn,
}: {
  readonly phase: Phase;
  readonly onSignIn: () => void | Promise<void>;
}) {
  return (
    <div className="grid h-full min-h-screen place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">shift-o-mator</h1>
        {phase.kind === 'starting' ? (
          <p className="mt-1 text-base text-muted">Checking your sign-in…</p>
        ) : phase.kind === 'failed' ? (
          <>
            <p className="mt-1 text-base text-muted">Could not sign you in.</p>
            <p className="mt-2 text-sm text-faint">{phase.message}</p>
          </>
        ) : (
          <p className="mt-1 text-base text-muted">
            Sign in with your work account to see the rota.
          </p>
        )}
        {phase.kind === 'starting' ? null : (
          <button type="button" className="btn btn--sm btn--primary mt-3" onClick={() => void onSignIn()}>
            {phase.kind === 'failed' ? 'Try again' : 'Sign in'}
          </button>
        )}
      </div>
    </div>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
