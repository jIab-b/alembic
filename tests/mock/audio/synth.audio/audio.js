export default function(){
 document.body.insertAdjacentHTML('beforeend','<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><path d="M0 40h40l20-30 20 60 20-60 20 60 20-30h180" stroke="coral" fill="none" stroke-width="5"/></svg>');
 const context=new AudioContext(),tone=new OscillatorNode(context),gain=new GainNode(context,{gain:0.01});
 const analyser=new AnalyserNode(context);tone.connect(gain).connect(analyser).connect(context.destination);
 return window.audioFixture={context,analyser,started:false,disposed:false,
  async play(){await context.resume();tone.start();this.started=true;},
  dispose(){tone.disconnect();context.close();this.disposed=true;}};
}