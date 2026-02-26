import { useEffect, useState, type ReactNode } from 'react';

interface SplashScreenProps {
  children: ReactNode;
}

const SLIDE_DELAY_MS = 2000;
const UNMOUNT_DELAY_MS = 2500;

export function SplashScreen({ children }: SplashScreenProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isSlidingUp, setIsSlidingUp] = useState(false);

  useEffect(() => {
    const slideTimer = window.setTimeout(() => {
      setIsSlidingUp(true);
    }, SLIDE_DELAY_MS);

    const unmountTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, UNMOUNT_DELAY_MS);

    return () => {
      window.clearTimeout(slideTimer);
      window.clearTimeout(unmountTimer);
    };
  }, []);

  return (
    <>
      {children}
      {isVisible && (
        <div className={`va-splash-screen ${isSlidingUp ? 'va-splash-screen--slide-up' : ''}`} aria-hidden>
          <div className="va-splash-screen__content">
            <h1 className="va-splash-screen__title">Built with VA</h1>
            <p className="va-splash-screen__subtitle">Wished into existence by va-wish-engine</p>
          </div>
        </div>
      )}
    </>
  );
}
