// Deterministic stereo rain. Circular filtering and wrapped droplets make the
// ten-second buffer periodic, without a fade-to-silence at its seam.
export const sampleRate = 48000;
export const duration = 10;
export function synthesizeRain() {
  let state = 0x7a391f2d;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const n = sampleRate * duration;
  const channels = [new Float32Array(n), new Float32Array(n)];
  for (const channel of channels) {
    const noise = Float32Array.from({length:n}, () => random() * 2 - 1);
    let low = 0, soft = 0, rumble = 0;
    // One warmup cycle settles all filter states to their periodic solution.
    for (let i = -n; i < n; i++) {
      const k = (i + n) % n, v = noise[k];
      low += 0.19 * (v - low);
      soft += 0.028 * (v - soft);
      rumble += 0.0015 * (v - rumble);
      if (i >= 0) {
        const t = i / n;
        const breeze = 0.94 + 0.045 * Math.sin(2*Math.PI*t) + 0.025 * Math.sin(6*Math.PI*t+1.2);
        channel[i] = ((low - soft)*0.72 + (v-low)*0.095 + (soft-rumble)*0.5) * breeze;
      }
    }
  }
  // Tiny, irregular soft impacts, panned across the field; tails wrap naturally.
  for (let drop = 0; drop < 1650; drop++) {
    const start = Math.floor(random()*n), pan = random();
    const gains = [Math.sqrt(1-pan),Math.sqrt(pan)];
    const length = Math.floor(sampleRate*(0.009 + random()*0.048));
    const freq = 800 + random()*3600, amplitude = 0.014 + Math.pow(random(),3)*0.16;
    let smooth = 0;
    for (let j=0; j<length; j++) {
      const u=j/length, envelope=(1-Math.exp(-j/19))*Math.exp(-u*7)*(1-u);
      smooth += 0.45*(random()*2-1-smooth);
      const value=amplitude*envelope*(smooth*0.8+Math.sin(j*2*Math.PI*freq/sampleRate)*0.2);
      for(let c=0;c<2;c++) channels[c][(start+j)%n] += value*gains[c];
    }
  }
  return channels;
}
