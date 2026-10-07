import { useEffect, useState } from 'react';

// Two updates per scroll burst, never a React update for each scroll event.
export default function useStudioActivity(host, expanded) {
  const [visible, setVisible] = useState(true);
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    let intersects = true;
    const update = () => setVisible(intersects && document.visibilityState !== 'hidden');
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      intersects = entries[0]?.isIntersecting ?? true;
      update();
    }, { rootMargin: '80px', threshold: 0 });
    observer?.observe(host);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [host]);
  useEffect(() => {
    let timer = 0, busy = false;
    const finish = () => { busy = false; setScrolling(false); };
    const scroll = () => {
      if (expanded) return;
      if (!busy) { busy = true; setScrolling(true); }
      clearTimeout(timer);
      timer = setTimeout(finish, 180);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener('scroll', scroll); finish(); };
  }, [expanded]);
  return { visible, scrolling };
}
