// Rebuild the portable WAV using precisely the same samples and gain as WebAudio.
import {synthesizeRain,sampleRate,duration} from './synthesis.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const gain=JSON.parse(await readFile(new URL('./level.json',import.meta.url),'utf8')).gain;
const channels=synthesizeRain(), n=sampleRate*duration;
const wav=Buffer.alloc(44+n*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*4,40);
for(let i=0;i<n;i++)for(let c=0;c<2;c++){const v=channels[c][i]*gain;if(Math.abs(v)>=1)throw Error('Rain clips');wav.writeInt16LE(Math.round(v*32767),44+i*4+c*2);}
await writeFile(new URL('./rain.wav',import.meta.url),wav);
