// The color sensor reading the mat photo. The photo covers the whole field at one pixel per
// millimetre or so; its top row is the far wall, so field y counts up from the bottom row.

// The sensor sees a small spot, about 8 mm across, so readings average a few pixels.
export const SPOT_R = 4;

// Name the color the way SPIKE does, from red, green, blue (0-255). Dark is black, pale is
// white, grey in between is no color, and everything else goes by hue. SPIKE has no orange,
// so sand and roofs read yellow.
export function classify(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255, s = max ? (max - min) / max : 0;
  if (v < 0.22) return 'black';
  if (s < 0.22) return v > 0.6 ? 'white' : v < 0.35 ? 'black' : 'none';
  let h;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 18 || h >= 330) return 'red';
  if (h < 70) return 'yellow';
  if (h < 175) return 'green';
  if (h < 200) return 'azure';
  if (h < 255) return 'blue';
  return 'violet';
}

// Reflected light in %, from brightness. Scaled so the printed black lines read about 8 and
// white about 98, like the plain mat.
export function reflectOf(r, g, b) {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return Math.round(8 + 90 * lum);
}

// Turns the photo's pixels (RGBA, like canvas ImageData) into a sensor reading at a field point
// in mm. Returns null off the mat, so the caller can report "none".
export function photoSampler(data, w, h, fw, fh) {
  const sx = w / fw, sy = h / fh, rr = SPOT_R * SPOT_R;
  return ([x, y]) => {
    if (x < 0 || x > fw || y < 0 || y > fh) return null;
    let R = 0, G = 0, B = 0, n = 0;
    for (let dy = -SPOT_R; dy <= SPOT_R; dy++) for (let dx = -SPOT_R; dx <= SPOT_R; dx++) {
      if (dx * dx + dy * dy > rr) continue;
      const px = Math.min(w - 1, Math.max(0, Math.floor((x + dx) * sx)));
      const py = Math.min(h - 1, Math.max(0, Math.floor((fh - y - dy) * sy)));
      const i = (py * w + px) * 4;
      R += data[i]; G += data[i + 1]; B += data[i + 2]; n++;
    }
    R /= n; G /= n; B /= n;
    return { color: classify(R, G, B), reflect: reflectOf(R, G, B) };
  };
}
