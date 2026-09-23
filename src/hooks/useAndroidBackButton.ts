import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { closeTopSheet } from '../components/Sheet';

/** The two screens where back means "leave the app": the dashboard, and the
 * very first onboarding screen. Everywhere else back steps within the app. */
const EXIT_ROUTES = new Set(['/today', '/onboarding/welcome']);

/** The other tab roots. Back from these returns to Today rather than replaying
 * whatever tab was visited before it, which is what Android users expect. */
const TAB_ROUTES = new Set(['/progress', '/squad', '/settings']);

/**
 * Wires Android's hardware/gesture back button to in-app navigation.
 *
 * Without this, Capacitor's default handler closes the WebView on every back
 * press, so the app quits from any screen instead of stepping back through it.
 */
export function useAndroidBackButton(): void {
  const navigate = useNavigate();
  const location = useLocation();

  // The listener is registered once; a ref keeps it reading the live path
  // instead of capturing the path from the render that registered it.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let remove: (() => void) | undefined;
    let cancelled = false;

    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      // An open sheet is the innermost thing on screen, so back dismisses it
      // before it does anything to the route underneath.
      if (closeTopSheet()) return;

      const path = pathRef.current;

      if (TAB_ROUTES.has(path)) {
        navigate('/today');
        return;
      }
      if (EXIT_ROUTES.has(path) || !canGoBack) {
        CapacitorApp.exitApp();
        return;
      }
      navigate(-1);
    }).then((handle) => {
      if (cancelled) handle.remove();
      else remove = () => handle.remove();
    });

    return () => { cancelled = true; remove?.(); };
  }, [navigate]);
}
