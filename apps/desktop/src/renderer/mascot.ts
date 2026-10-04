/** Animate only the eyes of the existing mascot artwork; CSS retains its float and tint. */
export function animateMascot(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;
  const artwork = new Image();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  type Eye = {
    x: number;
    y: number;
    rx: number;
    ry: number;
    left: string;
    right: string;
  };
  const eyes: Eye[] = [];
  const paint = (openness = 1) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(artwork, 0, 0);
    if (openness === 1) return;
    for (const eye of eyes) {
      const gradient = ctx.createLinearGradient(
        eye.x - eye.rx - 3,
        0,
        eye.x + eye.rx + 3,
        0,
      );
      gradient.addColorStop(0, eye.left);
      gradient.addColorStop(1, eye.right);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(eye.x, eye.y, eye.rx + 2, eye.ry + 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#080800";
      ctx.beginPath();
      ctx.ellipse(
        eye.x,
        eye.y,
        eye.rx,
        Math.max(1.5, eye.ry * openness),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };
  const schedule = () => {
    if (reducedMotion.matches || document.hidden) return;
    timer = setTimeout(
      () => {
        const start = performance.now();
        const blink = (now: number) => {
          const elapsed = (now - start) / 180;
          if (elapsed >= 1) {
            paint();
            schedule();
            return;
          }
          paint(Math.abs(Math.cos(elapsed * Math.PI)));
          frame = requestAnimationFrame(blink);
        };
        frame = requestAnimationFrame(blink);
      },
      3200 + Math.random() * 2400,
    );
  };
  const reset = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    if (!artwork.complete || !artwork.naturalWidth) return;
    paint();
    schedule();
  };
  artwork.onload = () => {
    canvas.width = artwork.naturalWidth;
    canvas.height = artwork.naturalHeight;
    paint();
    const { data, width, height } = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const color = (x: number, y: number) => {
      const offset = (Math.round(y) * width + Math.round(x)) * 4;
      return `rgb(${data[offset]}, ${data[offset + 1]}, ${data[offset + 2]})`;
    };
    // Find the two dark eyes in the central body rather than hard-code rendered pixel positions.
    for (const side of [0, 1]) {
      let left = width,
        top = height,
        right = 0,
        bottom = 0;
      for (let y = Math.floor(height * 0.25); y < height * 0.7; y++) {
        for (
          let x = Math.floor(width * (side ? 0.5 : 0.25));
          x < width * (side ? 0.75 : 0.5);
          x++
        ) {
          const offset = (y * width + x) * 4;
          if (
            data[offset]! < 65 &&
            data[offset + 1]! < 65 &&
            data[offset + 2]! < 65 &&
            data[offset + 3]! > 200
          ) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      if (right <= left || bottom <= top) continue;
      const x = (left + right) / 2,
        y = (top + bottom) / 2;
      eyes.push({
        x,
        y,
        rx: (right - left + 1) / 2,
        ry: (bottom - top + 1) / 2,
        left: color(left - 5, y),
        right: color(right + 5, y),
      });
    }
    reset();
  };
  reducedMotion.addEventListener("change", reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
  });
  artwork.src = "./mark.png";
}
