import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ScrollableTabBarProps {
  children: ReactNode;
}

export function ScrollableTabBar({ children }: ScrollableTabBarProps) {
  const navRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const { pathname } = useLocation();

  const updateArrows = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setCanScrollLeft(nav.scrollLeft > 4);
    setCanScrollRight(nav.scrollLeft + nav.offsetWidth < nav.scrollWidth - 4);
  }, []);

  // Scroll active tab into center
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // Small delay to let NavLink active class settle
    const timer = setTimeout(() => {
      const active = nav.querySelector<HTMLElement>(".bg-accent\\/10");
      if (!active) return;
      const scrollLeft = active.offsetLeft - nav.offsetWidth / 2 + active.offsetWidth / 2;
      nav.scrollTo({ left: scrollLeft, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(timer);
  }, [pathname]);

  // Track scroll position for arrow visibility
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    updateArrows();
    nav.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  const scroll = (dir: "left" | "right") => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollBy({ left: dir === "left" ? -120 : 120, behavior: "smooth" });
  };

  return (
    <div className="md:hidden relative flex items-center gap-0.5 pb-4">
      {/* Left arrow */}
      <button
        onClick={() => scroll("left")}
        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-transparent border-none cursor-pointer transition-opacity ${
          canScrollLeft ? "text-text-secondary opacity-100" : "text-text-tertiary opacity-0 pointer-events-none"
        }`}
        aria-label="Scroll left"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Scrollable nav */}
      <div
        ref={navRef}
        className="flex-1 flex gap-1 overflow-x-auto scrollbar-hidden"
      >
        {children}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll("right")}
        className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-transparent border-none cursor-pointer transition-opacity ${
          canScrollRight ? "text-text-secondary opacity-100" : "text-text-tertiary opacity-0 pointer-events-none"
        }`}
        aria-label="Scroll right"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
