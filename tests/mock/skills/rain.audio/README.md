# Rain

Open `rain.audio` as a node. Choose **Playback → Rain loop · 10 seconds**, then press Play. The audition ends after ten seconds; Play starts it again, and Escape resets it. Loading or choosing the scenario is silent.

Steady stereo rain synthesized locally with WebAudio: a filtered noise wash and irregular soft droplets. No fal, provider calls, downloaded models or recordings. The buffer is periodic: filters settle over a warmup cycle and droplet tails wrap across the boundary.

`rain.wav` is a portable 10-second stereo 48 kHz PCM16 export, also available in the Render menu. Its measured gain is used by the live player. `node render.mjs` rebuilds the WAV from the same source. Measurements are in `verification.json`.

Measured at −18.00 LUFS integrated, −11.26 dBTP. The node stays under 2 MB. Decoded seam levels and sample changes were checked numerically. Human listening has not been performed.
