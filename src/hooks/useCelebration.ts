import { useCallback } from "react";
import confetti from "canvas-confetti";

const GOAL_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1iZ2lnamVfW1thaG5zcnBqYl1cYWhuc3RybWZhXl5jaW50dXNuaGJfX2RqcHR1c29pY2BgZGpwdHVzb2ljYF9kam90dXJuaGJgYGRqb3R1cm5oYmBgZGpvdHVybmhiYGBkam90dXJuaGJgX2Rqb3R1cm5oYmBfZGpvdHVybmhiYF9kam90dXJuaGNhYGRqb3R1cm5oY2FgZGpvdHVybmhjYWBkam90";

export function useCelebration() {
  const celebrate = useCallback((element?: HTMLElement) => {
    // Confetti burst
    const defaults = {
      spread: 360,
      ticks: 100,
      gravity: 0.5,
      decay: 0.94,
      startVelocity: 30,
      colors: ["#FF8C00", "#FFD700", "#FFA500", "#FF6347", "#FFFFFF"],
    };

    const shoot = () => {
      confetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ["star"] });
      confetti({ ...defaults, particleCount: 20, scalar: 0.75, shapes: ["circle"] });
    };

    shoot();
    setTimeout(shoot, 150);
    setTimeout(shoot, 300);

    // Play a simple success tone using Web Audio API
    try {
      const ctx = new AudioContext();
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };
      playTone(523, 0, 0.15);
      playTone(659, 0.12, 0.15);
      playTone(784, 0.24, 0.3);
    } catch {}
  }, []);

  return { celebrate };
}
