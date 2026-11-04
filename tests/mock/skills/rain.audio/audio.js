import {synthesizeRain, sampleRate, duration} from './synthesis.mjs';
export default async function create() {
  const level = await fetch(new URL('./level.json', import.meta.url)).then(r => {if(!r.ok) throw Error('Cannot load rain level');return r.json()});
  const raw = synthesizeRain();
  document.body.insertAdjacentHTML('beforeend', `<div class="rain-preview"><div class="rain-icon" aria-hidden="true">╱ ╱ ╱<br> ╱ ╱ ╱<br>╱ ╱ ╱</div><h1>Rain</h1><p>Steady rain, softly falling.</p><div class="rain-meta">10 SECOND LOOP <span>·</span> STEREO</div><div class="rain-state" role="status">Ready</div><div class="rain-line"><i></i></div><small>Synthesized rain</small></div>`);
  const style = document.createElement('style');
  style.textContent = `body{background:#101b22!important;color:#d8e5e9;font:14px system-ui,sans-serif}.rain-preview{width:min(360px,75vw);text-align:center;padding:40px 0}.rain-icon{font-size:25px;line-height:1.5;letter-spacing:13px;color:#7ea6b5;margin:0 0 25px 12px}h1{font-size:34px;font-weight:400;letter-spacing:1px;margin:0 0 12px}p{color:#9bb0b8;font-size:14px;margin:0 0 30px}.rain-meta{font-size:10px;letter-spacing:2px;color:#96b0bc}.rain-meta span{margin:0 10px}.rain-state{font-size:12px;color:#b5cbd4;margin-top:30px}.rain-line{height:2px;background:#253b45;margin:16px auto 26px;width:210px;overflow:hidden}.rain-line i{display:block;height:100%;width:0;background:#95bfcb}small{font-size:10px;letter-spacing:.6px;color:#77909c}`;
  document.head.append(style);
  const status = document.querySelector('.rain-state'), line = document.querySelector('.rain-line i');
  let context, source, gain, analyser, timer, disposed = false;
  const api = {
    duration,
    get context(){return context}, get analyser(){return analyser},
    async play() {
      if(disposed) throw Error('Rain player has been disposed');
      this.pause();
      context ??= new AudioContext({sampleRate});
      if(!gain){gain=context.createGain();gain.gain.value=level.gain;analyser=context.createAnalyser();gain.connect(analyser).connect(context.destination);}
      await context.resume();
      if(disposed) return;
      const buffer = context.createBuffer(2,raw[0].length,sampleRate);
      raw.forEach((data,c)=>buffer.copyToChannel(data,c));
      source=context.createBufferSource();source.buffer=buffer;source.loop=true;source.connect(gain);source.start();
      source.stop(context.currentTime+duration);
      status.textContent='Playing';line.style.transition='none';line.style.width='0';
      void line.offsetWidth;line.style.transition=`width ${duration}s linear`;line.style.width='100%';
      timer=setTimeout(()=>this.pause(),duration*1000);
    },
    pause() {
      clearTimeout(timer);
      if(source){try{source.stop()}catch{}source.disconnect();source=null;}
      status.textContent='Ready';line.style.transition='none';line.style.width='0';
    },
    async dispose() {
      disposed=true;this.pause();gain?.disconnect();analyser?.disconnect();
      if(context&&context.state!=='closed')await context.close();style.remove();
    }
  };
  window.rainAudio=api;
  return api;
}
