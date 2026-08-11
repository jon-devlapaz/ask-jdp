import { useEffect, useRef } from "react";

const CURSOR_CLASS = "ask-jdp-custom-cursor";

function cursorMode(element) {
  if (!element || element === document.documentElement || element === document.body) {
    return "default";
  }
  if (element.closest?.(":disabled")) return "native";
  if (element.closest?.("a, button, [role='button']")) return "link";
  if (element.closest?.("input, textarea, p, h1, h2, h3, li")) return "text";
  return "default";
}

export function PortfolioCursor() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;

    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const state = {
      x: 0,
      y: 0,
      rawX: 0,
      rawY: 0,
      speed: 0,
      heading: 0,
      mode: "default",
      seen: false,
    };
    let active = false;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let lastTime = performance.now();
    let lastX = 0;
    let lastY = 0;

    function resize() {
      const density = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * density);
      canvas.height = Math.floor(height * density);
      context.setTransform(density, 0, 0, density, 0, 0);
    }

    function draw() {
      if (!active) return;
      animationFrame = window.requestAnimationFrame(draw);
      context.clearRect(0, 0, width, height);
      if (!state.seen) return;
      if (state.mode === "native") return;

      if (state.mode === "link") {
        context.fillStyle = "#c2a4a1";
        context.beginPath();
        context.arc(state.rawX, state.rawY, 3.5, 0, Math.PI * 2);
        context.fill();
        return;
      }

      if (state.mode === "text") {
        context.strokeStyle = "#868a90";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(state.rawX, state.rawY - 7);
        context.lineTo(state.rawX, state.rawY + 7);
        context.stroke();
        return;
      }

      state.x += (state.rawX - state.x) * 0.28;
      state.y += (state.rawY - state.y) * 0.28;
      context.save();
      context.translate(state.x, state.y);
      if (state.speed > 1) {
        const stretch = 1 + Math.min(0.5, state.speed / 45);
        context.rotate(state.heading);
        context.scale(stretch, 1 / stretch);
        context.rotate(-state.heading);
      }
      context.strokeStyle = "#868a90";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(0, 0, 5, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      context.fillStyle = "#cecece";
      context.beginPath();
      context.arc(state.x, state.y, 1.5, 0, Math.PI * 2);
      context.fill();
    }

    function syncActive() {
      const shouldRun = finePointer.matches && !reducedMotion.matches;
      document.documentElement.classList.toggle(CURSOR_CLASS, shouldRun);
      canvas.hidden = !shouldRun;
      if (shouldRun && !active) {
        active = true;
        lastTime = performance.now();
        animationFrame = window.requestAnimationFrame(draw);
      } else if (!shouldRun && active) {
        active = false;
        window.cancelAnimationFrame(animationFrame);
        context.clearRect(0, 0, width, height);
      }
    }

    function onPointerMove(event) {
      if (!active) return;
      const now = performance.now();
      const elapsed = Math.max(8, now - lastTime);
      const deltaX = event.clientX - lastX;
      const deltaY = event.clientY - lastY;
      state.speed = Math.hypot(deltaX, deltaY) / (elapsed / 16);
      state.heading = Math.atan2(deltaY, deltaX);
      state.rawX = event.clientX;
      state.rawY = event.clientY;
      state.mode = cursorMode(document.elementFromPoint(event.clientX, event.clientY));
      const useNativeCursor = state.mode === "native";
      document.documentElement.classList.toggle(CURSOR_CLASS, !useNativeCursor);
      canvas.style.visibility = useNativeCursor ? "hidden" : "visible";
      if (!state.seen) {
        state.x = event.clientX;
        state.y = event.clientY;
      }
      state.seen = true;
      lastTime = now;
      lastX = event.clientX;
      lastY = event.clientY;
    }

    function onResize() {
      resize();
      syncActive();
    }

    resize();
    syncActive();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    finePointer.addEventListener("change", syncActive);
    reducedMotion.addEventListener("change", syncActive);

    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      finePointer.removeEventListener("change", syncActive);
      reducedMotion.removeEventListener("change", syncActive);
      document.documentElement.classList.remove(CURSOR_CLASS);
    };
  }, []);

  return <canvas ref={canvasRef} className="portfolio-cursor" aria-hidden="true" />;
}
