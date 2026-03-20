import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface SwipeNavigationConfig {
  threshold?: number;
  velocityThreshold?: number;
  routes: string[];
}

export function useSwipeNavigation({
  threshold = 120,
  velocityThreshold = 0.3,
  routes
}: SwipeNavigationConfig) {
  const navigate = useNavigate();
  const location = useLocation();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const swipeOffsetRef = useRef(0);
  const isSwipingRef = useRef(false);
  const shouldAnimateRef = useRef(false);
  const routesRef = useRef(routes);
  const locationRef = useRef(location.pathname);
  routesRef.current = routes;
  locationRef.current = location.pathname;

  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipingHorizontally, setIsSwipingHorizontally] = useState(false);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('input') ||
        target.closest('select') ||
        target.closest('textarea') ||
        target.closest('[data-no-swipe]')
      ) return;

      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      swipeOffsetRef.current = 0;
      isSwipingRef.current = false;
      shouldAnimateRef.current = false;
      setIsSwipingHorizontally(false);
      setSwipeOffset(0);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      if (!isSwipingRef.current && Math.abs(deltaX) > 15) {
        if (Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
          isSwipingRef.current = true;
          // Mostra animazione solo se non siamo ai bordi
          const currentIndex = routesRef.current.indexOf(locationRef.current);
          const atStart = currentIndex === 0 && deltaX > 0;
          const atEnd = currentIndex === routesRef.current.length - 1 && deltaX < 0;
          shouldAnimateRef.current = !atStart && !atEnd;
          if (shouldAnimateRef.current) {
            setIsSwipingHorizontally(true);
          }
        }
      }

      if (isSwipingRef.current) {
        swipeOffsetRef.current = deltaX;
        if (shouldAnimateRef.current) {
          setSwipeOffset(deltaX);
        }
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      if (!touchStartRef.current) return;

      const deltaX = swipeOffsetRef.current;
      const deltaTime = Date.now() - touchStartRef.current.time;
      const velocity = Math.abs(deltaX) / deltaTime;

      setSwipeOffset(0);
      setIsSwipingHorizontally(false);

      if (Math.abs(deltaX) > threshold || velocity > velocityThreshold) {
        const modalOpen = document.querySelector('[data-no-swipe]');
        if (modalOpen) {
          if (deltaX > 0) {
            window.dispatchEvent(new CustomEvent('trackr:swipe-back'));
          }
        } else {
          const currentIndex = routesRef.current.indexOf(locationRef.current);
          if (currentIndex !== -1) {
            let nextIndex = -1;
            if (deltaX > 0 && currentIndex > 0) nextIndex = currentIndex - 1;
            else if (deltaX < 0 && currentIndex < routesRef.current.length - 1) nextIndex = currentIndex + 1;
            if (nextIndex !== -1) navigate(routesRef.current[nextIndex]);
          }
        }
      }

      touchStartRef.current = null;
      swipeOffsetRef.current = 0;
      isSwipingRef.current = false;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [navigate, threshold, velocityThreshold]);

  return { swipeOffset, isSwipingHorizontally };
}
