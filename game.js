'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = {
  score: document.getElementById('score'), distance: document.getElementById('distance'), speed: document.getElementById('speed'), level: document.getElementById('level'), coins: document.getElementById('coins'),
  fuelText: document.getElementById('fuelText'), fuelBar: document.getElementById('fuelBar'),
  healthText: document.getElementById('healthText'), healthBar: document.getElementById('healthBar'),
  effect: document.getElementById('effect'), boostText: document.getElementById('boostText'), boostBar: document.getElementById('boostBar'), start: document.getElementById('startScreen'),
  over: document.getElementById('gameOverScreen'), reason: document.getElementById('gameOverReason'),
  finalScore: document.getElementById('finalScore'), finalDistance: document.getElementById('finalDistance'), finalCoins: document.getElementById('finalCoins'), finalLevel: document.getElementById('finalLevel'), finalRecord: document.getElementById('finalRecord'), slotPanel: document.getElementById('slotPanel'),
  slotTrack: document.getElementById('slotTrack'), slotResult: document.getElementById('slotResult'),
  slotCountdown: document.getElementById('slotCountdown'),
  activeEffects: document.getElementById('activeEffects'), speedMode: document.getElementById('speedMode'), nitroGauge: document.getElementById('nitroGauge'), speedArc: document.getElementById('speedArc'), speedNeedle: document.getElementById('speedNeedle'), inputAction: document.getElementById('inputAction'), gasPedal: document.getElementById('gasPedal'), brakePedal: document.getElementById('brakePedal'), record: document.getElementById('record'), audioToggle: document.getElementById('audioToggle'),
  weatherAnnouncement: document.getElementById('weatherAnnouncement'), weatherAnnouncementIcon: document.getElementById('weatherAnnouncementIcon'), weatherAnnouncementName: document.getElementById('weatherAnnouncementName'), weatherAnnouncementEffect: document.getElementById('weatherAnnouncementEffect'), weatherStatus: document.getElementById('weatherStatus'), weatherStatusIcon: document.getElementById('weatherStatusIcon'), weatherStatusName: document.getElementById('weatherStatusName'), weatherStatusBar: document.getElementById('weatherStatusBar')
};

function resizeCanvas() {
  // Renderujemy 1:1 z rozmiarem okna do 2560×1440. Poprzedni limit 1600×900
  // powodował rozciąganie obrazu na ekranach Full HD i wyraźne rozmycie.
  const cssWidth = Math.max(320, Math.floor(window.innerWidth));
  const cssHeight = Math.max(320, Math.floor(window.innerHeight));
  const renderScale = Math.min(1, 2560 / cssWidth, 1440 / cssHeight);
  const width = Math.max(320, Math.floor(cssWidth * renderScale));
  const height = Math.max(320, Math.floor(cssHeight * renderScale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}
function baseCameraZoom() {
  const responsive = Math.min(canvas.width / 1600, canvas.height / 900);
  return Math.max(.56, Math.min(1.04, CONFIG.camera.zoom * responsive));
}
function cameraZoom() {
  return state?.cameraZoom || baseCameraZoom();
}
addEventListener('resize', resizeCanvas, { passive: true });
resizeCanvas();

const CONFIG = {
  world: { baseline: 650, gravity: 305, ceiling: -1700, fallLimit: 1350 },
  camera: { zoom: 0.66 },
  speed: { cruiseLimit: 1000, nitroLimit: 1900, displayCruise: 320, displayNitro: 600, overspeedRelease: 0.18 },
  car: {
    bodyWidth: 236,
    bodyHeight: 72,
    rearWheelX: -65,
    frontWheelX: 75,
    wheelY: -20,
    wheelSize: 52,
    wheelRadius: 23,
    suspensionRest: 30,
    bodyOffsetY: -22,
    airTorque: 3.65,
    maxAngularVelocity: 3.85,
    landingDamageSpeed: 385,
    headSensorX: 8,
    headSensorY: -49,
    headSensorRadius: 11
  }
};

const ASSETS = {
  chip: 'chip.png', fuel: 'fuel_can.png', slot: 'slot_pickup.png', car: 'car_body.png',
  carDamaged: 'car_body_damaged.png', carShadow: 'car_shadow.png', wheel: 'wheel.png', ground: 'soil_tile.jpg', nitro: 'nitro.png',
  boost: 'boost.png', damage: 'damage.png', repair: 'repair.png', death: 'death.png'
};
const images = {};
const patterns = {};
for (const [name, file] of Object.entries(ASSETS)) {
  const img = new Image();
  img.decoding = 'async';
  img.src = `assets/${file}`;
  images[name] = img;
  img.addEventListener('load', () => {
  }, { once: true });
}

const ITEMS = [
  { type:'nitro', label:'NITRO', icon:'nitro.png', emoji:'🔥', weight:26, result:'Nitro aktywne przez 6 sekund' },
  { type:'multiplier', label:'MNOŻNIK x2', icon:'multiplier.png', emoji:'×2', weight:24, result:'Monety x2 przez 12 sekund' },
  { type:'boost', label:'PRZYSPIESZENIE', icon:'boost.png', emoji:'⚡', weight:23, result:'Natychmiastowe przyspieszenie' },
  { type:'damage', label:'USZKODZENIE', icon:'damage.png', emoji:'💥', weight:8, result:'Auto traci 35% wytrzymałości' },
  { type:'repair', label:'NAPRAWA', icon:'repair.png', emoji:'🔧', weight:18, result:'Auto odzyskuje 45% wytrzymałości' },
  { type:'death', label:'ŚMIERĆ', icon:'death.png', emoji:'☠', weight:1, result:'Natychmiastowy koniec gry' }
];


const audio = {
  ctx: null,
  master: null,
  muted: localStorage.getItem('warszawiakMuted') === '1',
  ambienceReady: false,
  windGain: null,
  roadGain: null,
  nitroGain: null,
  synthGain: null,
  synthFilter: null,
  synthOscA: null,
  synthOscB: null,
  cityEventAt: 0,
  lastThrottle: false,
  lastNitro: false,

  makeNoiseBuffer(seconds = 2) {
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      // Delikatnie skorelowany szum bez ostrego cyfrowego „syczenia”.
      smooth = smooth * .92 + (Math.random() * 2 - 1) * .08;
      const envelope = Math.sin(Math.PI * i / length);
      data[i] = smooth * (.7 + envelope * .3);
    }
    return buffer;
  },

  createNoiseLayer({ filterType, frequency, q = .7 }) {
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    src.buffer = this.makeNoiseBuffer(2.4);
    src.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { src, filter, gain };
  },

  initAmbience() {
    if (!this.ctx || this.ambienceReady) return;
    this.ambienceReady = true;
    const wind = this.createNoiseLayer({ filterType: 'bandpass', frequency: 1150, q: .55 });
    const road = this.createNoiseLayer({ filterType: 'lowpass', frequency: 430, q: .35 });
    const nitro = this.createNoiseLayer({ filterType: 'bandpass', frequency: 1850, q: .8 });
    this.windGain = wind.gain;
    this.windFilter = wind.filter;
    this.roadGain = road.gain;
    this.roadFilter = road.filter;
    this.nitroGain = nitro.gain;
    this.nitroFilter = nitro.filter;

    // Zamiast imitacji silnika: bardzo cichy, muzyczny puls synthwave.
    // Dwie fale są celowo rozstrojone o kilka centów, dzięki czemu dźwięk
    // jest miękki i szeroki, ale nie brzmi jak kosiarka.
    const synthFilter = this.ctx.createBiquadFilter();
    const synthGain = this.ctx.createGain();
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    synthFilter.type = 'lowpass';
    synthFilter.frequency.value = 420;
    synthFilter.Q.value = .55;
    synthGain.gain.value = 0;
    oscA.type = 'triangle';
    oscB.type = 'sine';
    oscA.frequency.value = 55;
    oscB.frequency.value = 55.7;
    oscA.connect(synthFilter);
    oscB.connect(synthFilter);
    synthFilter.connect(synthGain);
    synthGain.connect(this.master);
    oscA.start();
    oscB.start();
    this.synthGain = synthGain;
    this.synthFilter = synthFilter;
    this.synthOscA = oscA;
    this.synthOscB = oscB;
    this.cityEventAt = this.ctx.currentTime + 7 + Math.random() * 7;
  },

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : .34;
        this.master.connect(this.ctx.destination);
        this.initAmbience();
      }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    this.initAmbience();
  },

  toggle() {
    this.unlock();
    this.muted = !this.muted;
    localStorage.setItem('warszawiakMuted', this.muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : .34, this.ctx.currentTime, .025);
    }
    if (ui.audioToggle) {
      ui.audioToggle.textContent = this.muted ? '🔇' : '🔊';
      ui.audioToggle.setAttribute('aria-pressed', String(this.muted));
    }
  },

  tone(freq=440, duration=.08, type='sine', volume=.16, slide=0) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || !this.master) return;
    const now=this.ctx.currentTime, osc=this.ctx.createOscillator(), gain=this.ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(freq,now);
    if(slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),now+duration);
    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001,volume),now+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    osc.connect(gain); gain.connect(this.master); osc.start(now); osc.stop(now+duration+.02);
  },

  noise(duration=.12, volume=.09, cutoff=900) {
    if(this.muted) return;
    this.unlock();
    if(!this.ctx||!this.master) return;
    const len=Math.max(1,Math.floor(this.ctx.sampleRate*duration));
    const buffer=this.ctx.createBuffer(1,len,this.ctx.sampleRate), data=buffer.getChannelData(0);
    for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
    const src=this.ctx.createBufferSource(), gain=this.ctx.createGain(), filter=this.ctx.createBiquadFilter();
    src.buffer=buffer; filter.type='lowpass'; filter.frequency.value=cutoff; gain.gain.value=volume;
    src.connect(filter); filter.connect(gain); gain.connect(this.master); src.start();
  },

  coin(){this.tone(880,.055,'square',.11,260);},
  fuel(){this.tone(300,.14,'sine',.13,180);},
  repair(){this.tone(520,.16,'triangle',.14,360);},
  slot(){this.tone(210,.09,'square',.12,140);setTimeout(()=>this.tone(320,.1,'square',.1,180),80);},
  reward(good=true){this.tone(good?520:150,.18,good?'triangle':'sawtooth',.17,good?420:-70);},
  nitro(){this.noise(.28,.12,2400);this.tone(150,.2,'triangle',.055,260);},
  impact(strength=.5){this.noise(.08+.12*strength,.08+.1*strength,700);this.tone(90,.12,'sine',.1,-45);},
  throttleBlip() {
    // Krótki, miękki impuls przy ruszaniu. Nie udaje silnika.
    this.tone(92,.10,'triangle',.020,32);
  },

  cityTramBell() {
    if (this.muted || !this.ctx) return;
    this.tone(760,.12,'sine',.028,-40);
    setTimeout(() => this.tone(700,.16,'sine',.022,-30), 135);
  },

  cityBirds() {
    if (this.muted || !this.ctx) return;
    const base = 1180 + Math.random() * 320;
    this.tone(base,.055,'sine',.018,260);
    setTimeout(() => this.tone(base*1.12,.045,'sine',.014,180), 90);
    setTimeout(() => this.tone(base*.92,.06,'sine',.012,230), 185);
  },

  citySiren() {
    if (this.muted || !this.ctx || !this.master) return;
    const now=this.ctx.currentTime;
    const osc=this.ctx.createOscillator();
    const gain=this.ctx.createGain();
    const filter=this.ctx.createBiquadFilter();
    osc.type='sine';
    filter.type='lowpass';
    filter.frequency.value=1350;
    osc.frequency.setValueAtTime(520,now);
    osc.frequency.linearRampToValueAtTime(690,now+.55);
    osc.frequency.linearRampToValueAtTime(520,now+1.1);
    gain.gain.setValueAtTime(.0001,now);
    gain.gain.linearRampToValueAtTime(.012,now+.18);
    gain.gain.linearRampToValueAtTime(.0001,now+1.25);
    osc.connect(filter); filter.connect(gain); gain.connect(this.master);
    osc.start(now); osc.stop(now+1.3);
  },

  maybeCityEvent(now, running, speedRatio) {
    if (!running || now < this.cityEventAt) return;
    // Rzadkie i bardzo ciche zdarzenia. Następne po 9–20 sekundach.
    this.cityEventAt = now + 9 + Math.random() * 11;
    const r = Math.random();
    if (r < .48) this.cityBirds();
    else if (r < .82) this.cityTramBell();
    else if (speedRatio > .18) this.citySiren();
  },

  updateEngine() {
    if (!state) return;
    this.unlock();
    if (!this.ctx || !this.ambienceReady) return;
    const now = this.ctx.currentTime;
    const running = state.running && !state.over && !this.muted;
    const car = state.car || {};
    const speedRatio = Math.max(0, Math.min(1, Math.abs(car.vx || car.forwardSpeed || 0) / CONFIG.speed.nitroLimit));
    const grounded = Boolean(car.grounded);
    const throttle = keys.has('w');
    const nitro = (keys.has(' ') && state.boost > 0) || state.time < state.nitroUntil;

    if (throttle && !this.lastThrottle && running) this.throttleBlip();
    if (nitro && !this.lastNitro && running) this.nitro();
    this.lastThrottle = throttle;
    this.lastNitro = nitro;

    // Przy spokojnej jeździe audio jest prawie niewidoczne. Poczucie prędkości
    // buduje wiatr, a nie męcząca, zapętlona imitacja silnika.
    const windTarget = running ? Math.max(0, (speedRatio - .10) / .90) : 0;
    const roadTarget = running && grounded ? Math.max(0, (speedRatio - .04) / .96) : 0;
    const nitroTarget = running && nitro ? (.035 + speedRatio * .075) : 0;

    this.windGain.gain.setTargetAtTime(windTarget * .090, now, .10);
    this.roadGain.gain.setTargetAtTime(roadTarget * (.018 + (throttle ? .005 : 0)), now, .08);
    this.nitroGain.gain.setTargetAtTime(nitroTarget, now, .045);
    this.windFilter.frequency.setTargetAtTime(620 + speedRatio * 1750, now, .12);
    this.roadFilter.frequency.setTargetAtTime(220 + speedRatio * 470, now, .10);
    this.nitroFilter.frequency.setTargetAtTime(1350 + speedRatio * 1900, now, .08);

    // Synth pojawia się dopiero podczas jazdy i pozostaje bardzo cichy.
    // Przy nitro otwiera się filtr, ale nie podnosi się agresywnie głośność.
    const synthTarget = running ? Math.max(0, (speedRatio - .06) / .94) : 0;
    const synthVolume = synthTarget * (throttle ? .020 : .011) * (grounded ? 1 : .72);
    const note = 46 + speedRatio * 34 + (nitro ? 9 : 0);
    this.synthGain.gain.setTargetAtTime(synthVolume, now, .18);
    this.synthFilter.frequency.setTargetAtTime(300 + speedRatio * 760 + (nitro ? 420 : 0), now, .20);
    this.synthOscA.frequency.setTargetAtTime(note, now, .16);
    this.synthOscB.frequency.setTargetAtTime(note * 1.008, now, .16);

    this.maybeCityEvent(now, running, speedRatio);
  }
};
if(ui.audioToggle){ui.audioToggle.textContent=audio.muted?'🔇':'🔊';ui.audioToggle.setAttribute('aria-pressed',String(audio.muted));ui.audioToggle.onclick=()=>audio.toggle();}

const keys = new Set();
addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (['w','a','s','d',' '].includes(key)) e.preventDefault();
  keys.add(key);
  if (key === 'r') resetGame(true);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
for (const button of document.querySelectorAll('.mobile-controls button')) {
  const key = button.dataset.key;
  const down = e => { e.preventDefault(); keys.add(key); };
  const up = e => { e.preventDefault(); keys.delete(key); };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('pointerleave', up);
}

document.getElementById('startBtn').onclick = () => { audio.unlock(); audio.tone(240,.14,'triangle',.13,180); ui.start.classList.add('hidden'); resetGame(true); };
document.getElementById('restartBtn').onclick = () => { audio.unlock(); audio.tone(220,.12,'triangle',.12,160); resetGame(true); };

let state;
function resetGame(startNow) {
  resetTerrain();
  state = {
    running: startNow, over: false, time: 0, cameraX: 0, cameraY: 0, cameraVY: 0, cameraZoom: baseCameraZoom(), screenShake: 0,
    score: 0, bonusScore: 0, stuntMultiplier: 1, stuntChain: 0, stuntPulse: 0, record: Number(localStorage.getItem('warszawiakRecord') || 0), distance: 0, level: 1, levelFlash: 0, coins: 0, fuel: 100, health: 100, boost: 100, multiplier: 1,
    multiplierUntil: 0, nitroUntil: 0, boostUntil: 0, lastNitroUseTime: -999,
    slotting: false, slotEndRealTime: 0, lightingPhase: 0, hudSpeed: 0, hudCoins: 0, hudSpeedAt: performance.now(),
    weatherUiType: 'clear', weatherAnnouncementUntil: 0,
    car: createCarState(),
    objects: [], particles: [], notifications: [], nextSpawnX: 900
  };
  // Startowa pozycja kamery: powierzchnia trasy zajmuje około 28% dolnej części ekranu.
  // Dzięki temu pierwsza klatka nie wykonuje gwałtownego pionowego skoku.
  {
    const z=state.cameraZoom;
    const desiredSurfaceScreenY=canvas.height*.84;
    const surfaceOffset=canvas.height*.5+(desiredSurfaceScreenY-canvas.height*.5)/z;
    state.cameraY=terrainY(state.car.x)-surfaceOffset;
  }
  ui.over.classList.add('hidden');
  ui.slotPanel.classList.add('hidden');
  ui.slotResult.textContent = '';
  if (ui.weatherAnnouncement) ui.weatherAnnouncement.classList.remove('show');
  if (ui.weatherStatus) ui.weatherStatus.classList.remove('active');
  seedWorld();
  updateHud();
}


function createCarState() {
  const x = 250;
  const pose = groundPoseAt(x, 0);
  return {
    x, y: pose.y, vx: 0, vy: 0, angle: pose.angle, angularVelocity: 0,
    grounded: true, forwardSpeed: 0, wheelSpin: 0,
    airStartY: pose.y, maxFallSpeed: 0, airtime: 0, airRotation: 0, lastAirAngle: pose.angle,
    throttleSmooth: 0, brakeSmooth: 0, settleTimer: 0, headContactTime: 0,
    wheels: [
      { side:-1, x:pose.rear.x, y:pose.rear.y, spin:0, grounded:true },
      { side: 1, x:pose.front.x, y:pose.front.y, spin:0, grounded:true }
    ]
  };
}

function wheelWorld(c, localX) {
  const cos=Math.cos(c.angle), sin=Math.sin(c.angle);
  const down=CONFIG.car.wheelY+CONFIG.car.suspensionRest;
  return { x:c.x+localX*cos-down*sin, y:c.y+localX*sin+down*cos };
}

function groundPoseAt(x, previousAngle=0) {
  // Jedna, wspólna poza kolizyjna dla kół i karoserii. Oba koła próbkują
  // dokładnie tę samą krzywą, którą później rysuje renderer.
  let angle=previousAngle;
  let rear,front;
  for(let i=0;i<6;i++){
    const cos=Math.cos(angle), sin=Math.sin(angle);
    const down=CONFIG.car.wheelY+CONFIG.car.suspensionRest;
    const rx=x+CONFIG.car.rearWheelX*cos-down*sin;
    const fx=x+CONFIG.car.frontWheelX*cos-down*sin;
    rear={x:rx,y:terrainY(rx)-CONFIG.car.wheelRadius};
    front={x:fx,y:terrainY(fx)-CONFIG.car.wheelRadius};
    const target=Math.atan2(front.y-rear.y,front.x-rear.x);
    angle+=normalizeAngle(target-angle)*.82;
  }
  const cos=Math.cos(angle), sin=Math.sin(angle);
  const down=CONFIG.car.wheelY+CONFIG.car.suspensionRest;
  const yr=rear.y-CONFIG.car.rearWheelX*sin-down*cos;
  const yf=front.y-CONFIG.car.frontWheelX*sin-down*cos;
  let y=(yr+yf)*.5;

  // Obrys podwozia jest częścią tej samej pozy. Na bardzo wypukłym fragmencie
  // auto może oprzeć się podwoziem, ale korekta jest ciągła i nie zależy od
  // poprzedniej klatki ani od binarnego testu „wolne/zablokowane”.
  const probe={x,y,angle};
  const samples=[
    [ CONFIG.car.bodyWidth*.48, CONFIG.car.bodyHeight*.18 ],
    [ CONFIG.car.bodyWidth*.38, CONFIG.car.bodyHeight*.30 ],
    [ 0,                         CONFIG.car.bodyHeight*.34 ],
    [-CONFIG.car.bodyWidth*.34, CONFIG.car.bodyHeight*.29 ]
  ];
  let lift=0;
  for(const [lx,ly] of samples){
    const pt=bodyPoint(probe,lx,ly);
    lift=Math.max(lift,pt.y+1.5-terrainY(pt.x));
  }
  if(lift>0)y-=Math.min(26,lift);

  const finalProbe={x,y,angle};
  rear=wheelWorld(finalProbe,CONFIG.car.rearWheelX);
  front=wheelWorld(finalProbe,CONFIG.car.frontWheelX);
  return {angle,y,rear,front};
}

function bodyPoint(c, lx, ly) {
  const cos=Math.cos(c.angle), sin=Math.sin(c.angle);
  return { x:c.x+lx*cos-ly*sin, y:c.y+lx*sin+ly*cos };
}

// Ruch po ziemi korzysta wyłącznie z ciągłej pozy wyznaczonej przez oba koła.
// Nie ma tu binarnego blokowania nosa ani ręcznego teleportowania nadwozia.
function moveGroundedCar(c, distance) {
  c.x += distance;
  return groundPoseAt(c.x, c.angle);
}

// Niewidoczny sensor głowy działa niezależnie od prędkości i stanu grounded.
// Dzięki temu powolne przewrócenie auta również kończy grę, a nie tylko mocny upadek.
function updateHeadSensor(c, dt) {
  const head = bodyPoint(c, CONFIG.car.headSensorX, CONFIG.car.headSensorY);
  const radius = CONFIG.car.headSensorRadius;
  const floor = terrainY(head.x);
  const floorPenetration = head.y + radius - floor;
  const localGroundAngle = terrainSlope(head.x);
  const relativeAngle = normalizeAngle(c.angle - localGroundAngle);
  const roofTowardGround = Math.cos(relativeAngle) < -0.18;

  // Sam sensor może przeciąć rosnące zbocze, gdy auto jest normalnie ustawione.
  // Kontakt z ziemią kończy grę dopiero, gdy dach/głowa są faktycznie skierowane
  // ku nawierzchni i sensor wszedł w nią o kilka pikseli.
  const floorHit = roofTowardGround && floorPenetration >= 3;
  const ceiling = tunnelCeilingY(head.x);
  const ceilingPenetration = ceiling === null ? 0 : ceiling - (head.y - radius);
  const ceilingHit = ceiling !== null && ceilingPenetration >= 3;

  if (floorHit || ceilingHit) {
    c.headContactTime += dt;
    if (c.headContactTime >= 0.055) {
      endGame(ceilingHit ? 'Uderzenie głową w sufit tunelu' : 'Dachowanie — głowa dotknęła ziemi');
      return true;
    }
  } else {
    c.headContactTime = 0;
  }
  return false;
}

function hash(n) { const x = Math.sin(n * 127.1) * 43758.5453123; return x - Math.floor(x); }
function smoothstep(t) { return t * t * (3 - 2 * t); }
function smootherstep(t) { t=Math.max(0,Math.min(1,t)); return t*t*t*(t*(t*6-15)+10); }
function normalizeAngle(a) { while (a > Math.PI) a -= Math.PI*2; while (a < -Math.PI) a += Math.PI*2; return a; }
const LEVEL_LENGTH = 60000; // około 6000 m na poziom
const TERRAIN_STEP = 24;
const BIOME_TRANSITION = 12000; // około 1200 m bardzo płynnego przejścia
const BIOMES = [
  {name:'ZIELONE PRZEDMIEŚCIA', end:70000, surface:['#a8df3b','#519326','#294817'], soil:['#e6aa63','#a75a28','#542817','#28140d'], sky:['#168ce8','#55c8f5','#e0f8ff'], amp:1.12, freq:1.12, slope:.72, cloud:.95, long:1.05, mid:1.18, short:.82, rough:.27, slopeChange:.034, pull:.00205, camera:.985, atmosphere:'calm'},
  {name:'MAZOWIECKI LAS', end:165000, surface:['#76bd35','#34731f','#203d18'], soil:['#b77b45','#76451f','#3d2415','#1e140f'], sky:['#267ab5','#76b9d4','#d7eadc'], amp:.88, freq:.76, slope:.62, cloud:1.18, long:1.44, mid:.72, short:.30, rough:.14, slopeChange:.022, pull:.00225, camera:.99, atmosphere:'leaves'},
  {name:'SKALISTE WZGÓRZA', end:285000, surface:['#a7a89a','#73766d','#41443f'], soil:['#a88b6b','#735a43','#44372e','#24201d'], sky:['#416f9e','#91b7cf','#e5edf0'], amp:1.28, freq:1.30, slope:.79, cloud:.76, long:.82, mid:1.22, short:1.10, rough:.34, slopeChange:.040, pull:.00190, camera:1.035, atmosphere:'wind'},
  {name:'ŚNIEŻNA DZIELNICA', end:430000, surface:['#ffffff','#dceaf2','#9eb8c8'], soil:['#8fa8b4','#657d88','#3d515c','#22323d'], sky:['#5f8ebd','#b8d7e8','#f5fbff'], amp:1.08, freq:.92, slope:.66, cloud:1.28, long:1.20, mid:.90, short:.38, rough:.12, slopeChange:.026, pull:.00215, camera:.97, atmosphere:'snow'},
  {name:'PIASZCZYSTA OBWODNICA', end:610000, surface:['#ffd76d','#d99f39','#9b6128'], soil:['#e5ae55','#b27331','#70431f','#362417'], sky:['#397db5','#e0a367','#ffe4a6'], amp:1.36, freq:.64, slope:.70, cloud:.42, long:1.70, mid:.54, short:.18, rough:.10, slopeChange:.020, pull:.00172, camera:.925, atmosphere:'dust'},
  {name:'WULKANICZNY FINAŁ', end:Infinity, surface:['#5d554e','#37322f','#211e1d'], soil:['#6b3425','#49231f','#2c1818','#150f12'], sky:['#34243f','#7b3d4d','#d8794e'], amp:1.58, freq:1.42, slope:.86, cloud:.66, long:.72, mid:1.28, short:1.36, rough:.42, slopeChange:.046, pull:.00155, camera:.95, atmosphere:'embers'}
];

// Climate System: zmienia wyłącznie nastrój świata — bez nowych obiektów.
// Jeden klimat trwa około 3600 m, a ostatnie 700 m płynnie przechodzi w kolejny.
const CLIMATE_LENGTH = 36000;
const CLIMATE_TRANSITION = 7000;
const CLIMATES = [
  {name:'MIAMI DAY', sky:['#168fe8','#59d5ef','#fff0c9'], tint:'#59c8ff', tintAlpha:.030, surface:'#b8ec64', surfaceMix:.08, soil:'#d59252', soilMix:.06, cloudDensity:.92, cloudScale:1.00, cloudSpeed:1.00},
  {name:'GOLDEN HOUR', sky:['#4b82e8','#f07fc2','#ffc07d'], tint:'#ffac74', tintAlpha:.052, surface:'#d5df56', surfaceMix:.11, soil:'#c97842', soilMix:.09, cloudDensity:.76, cloudScale:1.10, cloudSpeed:.82},
  {name:'FRESH MORNING', sky:['#52a9ee','#95e4ef','#f7fff1'], tint:'#9fefff', tintAlpha:.035, surface:'#a8e86a', surfaceMix:.09, soil:'#c98a53', soilMix:.05, cloudDensity:1.12, cloudScale:.92, cloudSpeed:.88},
  {name:'CORAL SUNSET', sky:['#645fe0','#e76faf','#ffad77'], tint:'#ff7ba7', tintAlpha:.046, surface:'#c6d55b', surfaceMix:.08, soil:'#b96542', soilMix:.10, cloudDensity:.70, cloudScale:1.18, cloudSpeed:.72},
  {name:'COOL AZURE', sky:['#397dcc','#70c9e9','#dff7ff'], tint:'#68b8ff', tintAlpha:.038, surface:'#83c76a', surfaceMix:.07, soil:'#9d795e', soilMix:.07, cloudDensity:1.02, cloudScale:1.04, cloudSpeed:1.12},
  {name:'PEACH GLOW', sky:['#627fdc','#efa0ba','#ffd8a3'], tint:'#ffc090', tintAlpha:.045, surface:'#c8db63', surfaceMix:.09, soil:'#c77e50', soilMix:.08, cloudDensity:.82, cloudScale:1.14, cloudSpeed:.78},
  {name:'VIOLET COAST', sky:['#6c66d9','#aa8ee9','#f0d8ff'], tint:'#a58cff', tintAlpha:.040, surface:'#9dd36a', surfaceMix:.07, soil:'#a16d62', soilMix:.07, cloudDensity:.88, cloudScale:1.08, cloudSpeed:.94},
  {name:'TURQUOISE DAWN', sky:['#198fd0','#66ddd8','#fff0d0'], tint:'#52e0d5', tintAlpha:.038, surface:'#9ee36f', surfaceMix:.09, soil:'#c48650', soilMix:.06, cloudDensity:1.04, cloudScale:.96, cloudSpeed:1.06}
];
function climateMixAt(distance){
  const raw=Math.max(0,distance);
  const cycle=Math.floor(raw/CLIMATE_LENGTH);
  const local=raw-cycle*CLIMATE_LENGTH;
  const i=cycle%CLIMATES.length;
  const next=(i+1)%CLIMATES.length;
  const start=CLIMATE_LENGTH-CLIMATE_TRANSITION;
  const t=local<=start?0:smootherstep((local-start)/CLIMATE_TRANSITION);
  return {a:CLIMATES[i],b:CLIMATES[next],t,index:t>.5?next:i,local,cycle};
}

let terrainPoints = [];
let terrainSeed = 1;
function levelForDistance(distance) { return Math.min(40, 1 + Math.floor(distance / LEVEL_LENGTH)); }
function phaseForDistance(distance){ return Math.floor(((distance/10)%24000)/4800); }
function biomeIndexAt(distance){ for(let i=0;i<BIOMES.length;i++) if(distance<BIOMES[i].end) return i; return BIOMES.length-1; }
function biomeMixAt(distance){
  const i=biomeIndexAt(distance), current=BIOMES[i];
  if(i>=BIOMES.length-1) return {a:current,b:current,t:0,index:i};
  const edge=current.end;
  const t=smootherstep((distance-(edge-BIOME_TRANSITION))/(BIOME_TRANSITION*2));
  return {a:current,b:BIOMES[i+1],t,index:t>.5?i+1:i};
}
function mixNum(a,b,t){return a+(b-a)*t;}

function weatherAt(distance){
  // Pogoda działa w powtarzalnych cyklach: krótki spokojny początek,
  // dłuższe zjawisko i spokojne wygaszenie. Pierwszy efekt pojawia się
  // już po około 250 m, zamiast dopiero po blisko 2 km.
  const raw=Math.max(0,distance);
  const cycleLength=15000;   // około 1500 m
  const weatherStart=2500;   // około 250 m czystej jazdy
  const weatherEnd=11500;    // około 900 m aktywnej pogody
  const transition=1600;     // około 160 m płynnego wejścia/wyjścia
  const cycle=Math.floor(raw/cycleLength);
  const local=raw-cycle*cycleLength;
  const eventRoll=hash(cycle*17.17+terrainSeed*.000013+3.71);
  const variant=hash(cycle*41.73+terrainSeed*.000029+8.13);
  const direction=hash(cycle*79.31+terrainSeed*.000043)>.5?1:-1;

  let envelope=0;
  if(local>=weatherStart&&local<=weatherEnd){
    const fadeIn=smootherstep(Math.min(1,(local-weatherStart)/transition));
    const fadeOut=smootherstep(Math.min(1,(weatherEnd-local)/transition));
    envelope=Math.min(fadeIn,fadeOut);
  }

  let type='clear';
  if(eventRoll<.31) type='rain';
  else if(eventRoll<.51) type='wind';
  else if(eventRoll<.67) type='fog';
  else if(eventRoll<.80) type='heat';
  else if(eventRoll<.92) type='snow';
  else type='storm';

  const base=.58+variant*.30;
  const intensity=envelope*base;
  let rain=0,snow=0,storm=0,wind=0,fog=0,heat=0;
  if(type==='rain') rain=intensity;
  if(type==='wind') wind=intensity;
  if(type==='fog') fog=intensity;
  if(type==='heat') heat=intensity;
  if(type==='snow') snow=intensity*.88;
  if(type==='storm'){
    rain=intensity*.92;
    wind=intensity*.74;
    storm=intensity;
  }
  if(intensity<=.001) type='clear';
  const eventProgress=type==='clear'?0:Math.max(0,Math.min(1,(local-weatherStart)/(weatherEnd-weatherStart)));
  const remaining=type==='clear'?0:1-eventProgress;
  return {type,intensity,rain,snow,storm,wind,fog,heat,windDirection:direction,eventProgress,remaining,cycle,local};
}

const WEATHER_UI = {
  rain:{icon:'🌧️',name:'DESZCZ',effect:'Przyczepność −6% • hamowanie słabsze'},
  wind:{icon:'💨',name:'SILNY WIATR',effect:'Podmuchy wpływają na auto w locie'},
  fog:{icon:'🌫️',name:'MGŁA',effect:'Ograniczona widoczność'},
  heat:{icon:'☀️',name:'UPAŁ',effect:'Nitro zużywa się do 12% szybciej'},
  snow:{icon:'❄️',name:'ŚNIEG',effect:'Przyczepność −8%'},
  storm:{icon:'⛈️',name:'BURZA',effect:'Śliska nawierzchnia • podmuchy w locie'}
};
function updateWeatherHud(weather){
  if(!state||!ui.weatherStatus||!ui.weatherAnnouncement)return;
  const active=weather.type!=='clear'&&weather.intensity>.018;
  if(active){
    const meta=WEATHER_UI[weather.type]||WEATHER_UI.rain;
    ui.weatherStatusIcon.textContent=meta.icon;
    ui.weatherStatusName.textContent=meta.name;
    ui.weatherStatusBar.style.width=`${Math.max(0,Math.min(100,(weather.remaining||0)*100))}%`;
    ui.weatherStatus.classList.add('active');
    if(state.weatherUiType!==weather.type){
      state.weatherUiType=weather.type;
      state.weatherAnnouncementUntil=state.time+2.8;
      ui.weatherAnnouncementIcon.textContent=meta.icon;
      ui.weatherAnnouncementName.textContent=meta.name;
      ui.weatherAnnouncementEffect.textContent=meta.effect;
      ui.weatherAnnouncement.classList.add('show');
    }
  }else{
    ui.weatherStatus.classList.remove('active');
    if(state.weatherUiType!=='clear')state.weatherUiType='clear';
  }
  ui.weatherAnnouncement.classList.toggle('show',state.time<state.weatherAnnouncementUntil);
}

function resetTerrain() {
  terrainSeed = (Math.random() * 0x7fffffff) | 0;
  terrainPoints = [{ x: -1200, y: CONFIG.world.baseline, slope: 0 }];
  ensureTerrainTo(7000);
}
function ensureTerrainTo(x) {
  while (terrainPoints[terrainPoints.length - 1].x < x + TERRAIN_STEP * 2) {
    const prev=terrainPoints[terrainPoints.length-1], nx=prev.x+TERRAIN_STEP;
    const distance=Math.max(0,nx-250), level=levelForDistance(distance), bm=biomeMixAt(distance);
    const prop=name=>mixNum(bm.a[name],bm.b[name],bm.t);
    const amp=prop('amp')*(1+Math.min(.34,(level-1)*.021));
    const freq=prop('freq'), maxSlope=prop('slope');
    const longWeight=prop('long'), midWeight=prop('mid'), shortWeight=prop('short');
    const roughness=prop('rough'), slopeChangeBase=prop('slopeChange'), baselinePull=prop('pull');
    // Trasa jest budowana z płynnie łączonych sekcji. Już pierwszy poziom wymaga
    // aktywnej jazdy, ale ograniczenie nachylenia nadal zapobiega pionowym ścianom.
    const sectionLength=1800;
    const section=Math.floor(nx/sectionLength);
    const local=(nx-section*sectionLength)/sectionLength;
    const edgeBlend=smootherstep(Math.min(1,Math.min(local,1-local)*7));
    const sectionRoll=hash(section+terrainSeed*.00017);
    const sectionMood=.94+hash(section+terrainSeed*.00031)*.34;
    const difficulty=.38+Math.min(.62,(level-1)*.055);
    const longWave=Math.sin(nx/(1120/freq)+.35+section*.11)*.235*longWeight;
    const midWave=Math.sin(nx/(470/freq)+1.70+section*.19)*.245*midWeight;
    const shortWave=Math.sin(nx/(210/freq)+2.45)*.13*shortWeight;
    const organic=(hash(Math.floor(nx/690)+31+terrainSeed*.000013)-.5)*roughness+
      (hash(Math.floor(nx/1390)+91+terrainSeed*.000021)-.5)*roughness*.58;

    let challenge=0;
    if(sectionRoll<.22){ // seria szybkich fal
      challenge=Math.sin(local*Math.PI*6.0)*(.16+.14*difficulty);
    }else if(sectionRoll<.44){ // długa dolina i wyjazd
      challenge=-Math.sin(local*Math.PI*2)*(.24+.17*difficulty);
    }else if(sectionRoll<.66){ // skocznia: mocny podjazd i łagodny zjazd
      challenge=(Math.sin(local*Math.PI*2-.65)+.28*Math.sin(local*Math.PI*4))*(.22+.18*difficulty);
    }else if(sectionRoll<.84){ // dwa wyraźne grzbiety
      challenge=Math.sin(local*Math.PI*4)*(.19+.15*difficulty);
    }else{ // dłuższy techniczny odcinek
      challenge=(.68*Math.sin(local*Math.PI*5)+.32*Math.sin(local*Math.PI*9))*(.16+.13*difficulty);
    }
    challenge*=edgeBlend;
    const feature=Math.sin((nx+hash(section+17)*900)/(1550/freq))*roughness*.27;
    const targetSlope=(longWave+midWave+shortWave+organic+feature+challenge)*amp*sectionMood;
    const desired=Math.max(-maxSlope,Math.min(maxSlope,targetSlope));
    const maxSlopeChange=slopeChangeBase+.004+Math.min(.017,level*.00065);
    let slope=prev.slope+Math.max(-maxSlopeChange,Math.min(maxSlopeChange,desired-prev.slope));
    slope=Math.max(-maxSlope,Math.min(maxSlope,slope));
    let y=prev.y+slope*TERRAIN_STEP;
    y+=(CONFIG.world.baseline-y)*baselinePull;
    terrainPoints.push({x:nx,y,slope});
  }
}
function terrainY(x) {
  ensureTerrainTo(x);
  const raw=(x-terrainPoints[0].x)/TERRAIN_STEP;
  const i=Math.max(0,Math.min(terrainPoints.length-2,Math.floor(raw)));
  const t=Math.max(0,Math.min(1,raw-i));
  const a=terrainPoints[i],b=terrainPoints[i+1];
  // Sześcienna interpolacja Hermite'a wykorzystuje zapisane nachylenia.
  // Powierzchnia ma ciągłą pochodną, więc koła i karoseria nie dostają
  // skokowej zmiany wysokości na granicy kolejnych punktów generatora.
  const t2=t*t,t3=t2*t;
  const h00=2*t3-3*t2+1;
  const h10=t3-2*t2+t;
  const h01=-2*t3+3*t2;
  const h11=t3-t2;
  return h00*a.y+h10*TERRAIN_STEP*a.slope+h01*b.y+h11*TERRAIN_STEP*b.slope;
}
function terrainSlope(x) { return Math.atan2(terrainY(x + 12) - terrainY(x - 12), 24); }
function terrainCurvature(x) { return terrainSlope(x + 70) - terrainSlope(x - 70); }

// Długi tunel pojawia się w 8. poziomie. Wejście i wyjście są płynne,
// więc sufit nie materializuje się nagle nad samochodem.
const TUNNEL_START_X = LEVEL_LENGTH * 7 + 8000;
const TUNNEL_END_X = TUNNEL_START_X + 42000;
const TUNNEL_FADE = 4800;
function tunnelFactorAt(x) {
  const enter = smootherstep((x - TUNNEL_START_X) / TUNNEL_FADE);
  const leave = smootherstep((TUNNEL_END_X - x) / TUNNEL_FADE);
  return Math.max(0, Math.min(enter, leave));
}
function tunnelCeilingY(x) {
  const factor = tunnelFactorAt(x);
  if (factor <= .001) return null;
  const gap = 455 + Math.sin(x / 1180) * 38 + Math.sin(x / 410) * 13;
  // Podczas przejść sufit odsuwa się wysoko, aby zachować łagodne wejście.
  return terrainY(x) - gap - (1 - factor) * 720;
}
function applyTunnelCeilingCollision(c) {
  if (tunnelFactorAt(c.x) <= .01) return;
  const samples = [
    bodyPoint(c, -52, -CONFIG.car.bodyHeight * .62),
    bodyPoint(c, 0, -CONFIG.car.bodyHeight * .70),
    bodyPoint(c, 52, -CONFIG.car.bodyHeight * .62)
  ];
  let penetration = 0;
  for (const point of samples) {
    const ceiling = tunnelCeilingY(point.x);
    if (ceiling !== null) penetration = Math.max(penetration, ceiling - point.y);
  }
  if (penetration <= 0) return;
  c.y += penetration + 2;
  if (c.vy < 0) {
    const impact = -c.vy;
    c.vy = Math.min(55, impact * .12);
    if (impact > 250) {
      const damage = (impact - 250) * .012;
      state.health -= damage;
      state.screenShake = Math.min(10, 2 + damage * .35);
    }
  }
  c.angularVelocity *= .55;
}

function seedWorld() { while (state.nextSpawnX < 6000) spawnObjectGroup(); }

function coinPattern(level) {
  const bases = [
    {name:'line',p:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0]]},
    {name:'longLine',p:[[0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],[7,0],[8,0]]},
    {name:'arc',p:[[0,0],[1,40],[2,78],[3,100],[4,78],[5,40],[6,0]]},
    {name:'wideArc',p:[[0,0],[1,28],[2,58],[3,82],[4,94],[5,82],[6,58],[7,28],[8,0]]},
    {name:'doubleArc',p:[[0,0],[1,44],[2,72],[3,44],[4,0],[5,44],[6,72],[7,44],[8,0]]},
    {name:'stairs',p:[[0,0],[1,22],[2,44],[3,66],[4,88],[5,110]]},
    {name:'softStairs',p:[[0,0],[1,14],[2,28],[3,42],[4,56],[5,70],[6,84],[7,98]]},
    {name:'valley',p:[[0,72],[1,40],[2,12],[3,0],[4,12],[5,40],[6,72]]},
    {name:'deepValley',p:[[0,104],[1,68],[2,34],[3,8],[4,0],[5,8],[6,34],[7,68],[8,104]]},
    {name:'wave',p:[[0,18],[1,58],[2,18],[3,58],[4,18],[5,58],[6,18]]},
    {name:'smoothWave',p:[[0,20],[1,50],[2,72],[3,50],[4,20],[5,0],[6,20],[7,50],[8,72]]},
    {name:'zigzag',p:[[0,0],[1,68],[2,0],[3,68],[4,0],[5,68],[6,0]]},
    {name:'v',p:[[0,82],[1,50],[2,20],[3,0],[4,20],[5,50],[6,82]]},
    {name:'w',p:[[0,74],[1,18],[2,62],[3,0],[4,62],[5,18],[6,74]]},
    {name:'crown',p:[[0,0],[1,52],[2,18],[3,88],[4,18],[5,52],[6,0]]},
    {name:'diamond',p:[[0,48],[1,78],[2,100],[3,78],[4,48],[3,18],[2,0],[1,18]]},
    {name:'gate',p:[[0,0],[0,48],[0,96],[1,112],[2,112],[3,112],[4,96],[4,48],[4,0]]},
    {name:'twoRows',p:[[0,0],[1,0],[2,0],[3,0],[4,0],[0,52],[1,52],[2,52],[3,52],[4,52]]},
    {name:'rampReward',p:[[0,0],[1,18],[2,42],[3,72],[4,104],[5,104],[6,72],[7,42],[8,18]]},
    {name:'airTrail',p:[[0,0],[1,26],[2,52],[3,78],[4,102],[5,118],[6,126],[7,118],[8,102],[9,78],[10,52],[11,26],[12,0]]},
    {name:'smallBurst',p:[[0,30],[1,60],[2,30],[1,0],[1,30]]},
    {name:'snake',p:[[0,18],[1,46],[2,68],[3,46],[4,18],[5,0],[6,18],[7,46],[8,68],[9,46]]},
    {name:'plateau',p:[[0,0],[1,32],[2,64],[3,64],[4,64],[5,64],[6,32],[7,0]]},
    {name:'landingLine',p:[[0,100],[1,76],[2,54],[3,34],[4,18],[5,8],[6,0],[7,0],[8,0]]}
  ];
  const available=Math.min(bases.length,8+Math.floor(level*.75));
  const base=bases[Math.floor(Math.random()*available)];
  let points=base.p.map(([x,y])=>[x,y]);
  // Warianty lustrzane i delikatnie rozciągnięte dają ponad 50 czytelnych układów
  // bez generowania chaotycznych lub niemożliwych do zebrania kształtów.
  const mirror=Math.random()<.34;
  const maxX=Math.max(...points.map(v=>v[0]));
  if(mirror) points=points.map(([x,y])=>[maxX-x,y]).sort((a,b)=>a[0]-b[0]);
  const vertical=[.82,1,1.16][Math.floor(Math.random()*3)];
  points=points.map(([x,y])=>[x,y*vertical]);
  return {name:base.name+(mirror?'-mirror':'')+'-'+vertical.toFixed(2),points};
}

function spawnCoinPattern(startX, level) {
  const pattern = coinPattern(level);
  const spacing = 72 + Math.random() * 18;
  const heightScale = .82 + Math.min(.28, level * .018);
  for (const [column, height] of pattern.points) {
    const x = startX + column * spacing;
    // Każda moneta jest liczona względem lokalnej ziemi, dzięki czemu układ
    // pozostaje możliwy do zebrania także na pochyłym terenie.
    const y = terrainY(x) - 58 - Math.min(128, height * heightScale);
    state.objects.push({ type:'chip', x, y, size:57.2, active:true, phase:Math.random()*Math.PI*2, rotation:0, pattern:pattern.name });
  }
  return pattern.points.length * spacing;
}

function spawnObjectGroup() {
  const startX = state.nextSpawnX;
  const level = levelForDistance(startX - 250);
  const roll = Math.random();
  if (roll < .48) {
    const patternWidth = spawnCoinPattern(startX, level);
    state.nextSpawnX += patternWidth + 1120 + Math.random() * 1180;
  } else if (roll < .73) {
    const x = startX;
    state.objects.push({ type:'fuel', x, y:terrainY(x)-64, size:80.3, active:true, phase:Math.random()*Math.PI*2, rotation:0 });
    state.nextSpawnX += 2200 + Math.random() * 1800;
  } else if (roll < .84) {
    // Osobna, rzadsza znajdźka naprawy. Umieszczona trochę nad trasą,
    // aby czasem wymagała lekkiego wybicia, ale nie była zależna od losowania.
    const x = startX;
    state.objects.push({ type:'repair', x, y:terrainY(x)-66-Math.random()*28, size:68.2, active:true, phase:Math.random()*Math.PI*2, rotation:0 });
    state.nextSpawnX += 4200 + Math.random() * 3200;
  } else {
    const x = startX;
    state.objects.push({ type:'slot', x, y:terrainY(x)-74-Math.random()*34, size:83.6, active:true, phase:Math.random()*Math.PI*2, rotation:0 });
    state.nextSpawnX += 3000 + Math.random() * 2400;
  }
}

function addNotification(text, color='#ffffff', life=4.6) {
  // Powiadomienia mają trzy czytelne fazy: wejście, spokojne wyświetlanie i zanik.
  // `age` pozwala animować wejście niezależnie od czasu pozostałego do usunięcia.
  state.notifications.push({ text, color, life, maxLife: life, age: 0 });
  if (state.notifications.length > 5) state.notifications.shift();
}
function updateNotifications(dt) {
  for (const n of state.notifications) {
    n.age = (n.age || 0) + dt;
    n.life -= dt;
  }
  state.notifications = state.notifications.filter(n => n.life > 0);
}



// Niezależny model kontaktu kół. Nadwozie jest dynamiczną bryłą, a każde koło
// może osobno dotykać terenu. Kontakt jednego koła nie ustawia drugiego na ziemi.
function wheelAnchorWorld(c, localX) {
  const cos=Math.cos(c.angle), sin=Math.sin(c.angle);
  const down=CONFIG.car.wheelY+CONFIG.car.suspensionRest;
  return {x:c.x+localX*cos-down*sin, y:c.y+localX*sin+down*cos, rx:localX*cos-down*sin, ry:localX*sin+down*cos};
}

function applyForceAtPoint(acc, fx, fy, rx, ry) {
  acc.ax += fx;
  acc.ay += fy;
  // Zwiększona bezwładność stabilizuje bryłę bez odbierania graczowi kontroli w locie.
  acc.torque += (rx*fy-ry*fx)/11800;
}

function resolveGroundPoint(c, acc, point, radius, stiffness, damping, friction, driveForce=0, weatherGrip=1) {
  const surface=terrainY(point.x);
  const slope=terrainSlope(point.x);
  const tx=Math.cos(slope), ty=Math.sin(slope);
  const nx=Math.sin(slope), ny=-Math.cos(slope);
  const penetration=point.y+radius-surface;
  if(penetration<=0) return {contact:false, penetration:0, x:point.x, y:point.y, slope};

  const pvx=c.vx-c.angularVelocity*point.ry;
  const pvy=c.vy+c.angularVelocity*point.rx;
  const vn=pvx*nx+pvy*ny;
  const vt=pvx*tx+pvy*ty;
  let normal=penetration*stiffness-vn*damping;
  normal=Math.max(0,Math.min(5200,normal));
  const tractionLimit=Math.max(1150,normal*friction*1.32*weatherGrip);
  const tangent=Math.max(-tractionLimit,Math.min(tractionLimit,driveForce-vt*1.12));
  applyForceAtPoint(acc,nx*normal+tx*tangent,ny*normal+ty*tangent,point.rx,point.ry);

  // Niewielka, ciągła korekta pozycji zapobiega tunelowaniu bez teleportowania bryły.
  const correction=Math.min(2.4,penetration*.16);
  c.x+=nx*correction;
  c.y+=ny*correction;
  return {contact:true, penetration, x:point.x, y:surface-radius, slope, normal};
}

function finishLanding(c, impact) {
  if(impact>CONFIG.car.landingDamageSpeed){
    const damage=(impact-CONFIG.car.landingDamageSpeed)*.022;
    state.health=Math.max(0,state.health-damage);
    state.screenShake=Math.min(15,3+damage*.28);
    burst(c.x,terrainY(c.x),Math.min(18,5+Math.floor(damage/3)),'dust');
  }
  const completedFlips=Math.floor(c.airRotation/(Math.PI*2));
  const airPoints=c.airtime>=.65?Math.floor(c.airtime*180):0;
  const flipPoints=completedFlips*750;
  const baseStuntPoints=airPoints+flipPoints;
  if(baseStuntPoints>0){
    const earned=Math.round(baseStuntPoints*state.stuntMultiplier);
    state.bonusScore+=earned;state.stuntChain++;
    const growth=completedFlips*.42+Math.min(.34,c.airtime*.055)+(impact<235?.18:0);
    state.stuntMultiplier=Math.min(8,Math.round((state.stuntMultiplier+growth)*10)/10);
    state.stuntPulse=1;
    const parts=[];
    if(completedFlips)parts.push(`${completedFlips}× PIRUET`);
    if(airPoints)parts.push(`LOT ${c.airtime.toFixed(1)} s`);
    parts.push(`+${earned}`);
    addNotification(parts.join('  •  '),completedFlips?'#ffe66d':'#dff8ff',2.2);
  }else if(impact>430){state.stuntMultiplier=1;state.stuntChain=0;}
  c.airtime=0;c.airRotation=0;c.maxFallSpeed=0;
}

function update(dt) {
  updateParticles(dt);
  if(state) updateNotifications(dt);
  if (!state.running || state.over) return;
  state.time += dt;
  const c=state.car;
  const throttle=keys.has('w'), brake=keys.has('s');
  const tilt=((keys.has('d')?1:0)-(keys.has('a')?1:0));
  const boostKey=keys.has(' ') && state.boost>0;
  const nitroActive=boostKey || state.time<state.nitroUntil;
  const weather=weatherAt(Math.max(0,c.x-250));
  updateWeatherHud(weather);
  const boosted=state.time<state.boostUntil;
  const currentLevel=levelForDistance(Math.max(0,c.x-250));
  if(currentLevel!==state.level){state.level=currentLevel;state.levelFlash=0;}
  state.lightingPhase=phaseForDistance(Math.max(0,c.x-250));
  state.levelFlash=Math.max(0,state.levelFlash-dt);

  // Nitro zużywa się podczas trzymania spacji. Po krótkiej przerwie zaczyna
  // łagodnie się odnawiać, dzięki czemu wskaźnik i mechanika nie zostają na zero.
  if(boostKey){
    state.boost=Math.max(0,state.boost-27*(1+weather.heat*.12)*dt);
    state.lastNitroUseTime=state.time;
  }else if(state.time-state.lastNitroUseTime>1.35 && state.boost<100){
    state.boost=Math.min(100,state.boost+6.5*dt);
  }
  c.throttleSmooth+=(Number(throttle)-c.throttleSmooth)*Math.min(1,dt*8.8);
  c.brakeSmooth+=(Number(brake)-c.brakeSmooth)*Math.min(1,dt*4.8);

  const steps=Math.max(5,Math.min(12,Math.ceil(dt*360)));
  const h=dt/steps;
  for(let step=0;step<steps;step++){
    const wasGrounded=c.grounded;
    const acc={ax:0,ay:CONFIG.world.gravity,torque:0};
    const weatherGrip=1-weather.rain*.06-weather.snow*.08;
    const drive=(nitroActive?5700:boosted?4650:2700)*c.throttleSmooth*weatherGrip;
    const brakePower=1380*c.brakeSmooth*(1-weather.rain*.08-weather.snow*.06);

    const rearAnchor=wheelAnchorWorld(c,CONFIG.car.rearWheelX);
    const frontAnchor=wheelAnchorWorld(c,CONFIG.car.frontWheelX);
    const preRearSurface=terrainY(rearAnchor.x);
    const preFrontSurface=terrainY(frontAnchor.x);
    const rearNear=rearAnchor.y+CONFIG.car.wheelRadius>preRearSurface-6;
    const frontNear=frontAnchor.y+CONFIG.car.wheelRadius>preFrontSurface-6;
    const contactEstimate=(rearNear?1:0)+(frontNear?1:0);
    const distributedDrive=contactEstimate?drive/contactEstimate:0;

    const rearContact=resolveGroundPoint(c,acc,rearAnchor,CONFIG.car.wheelRadius,1120,78,.82,
      distributedDrive-(rearNear?brakePower*Math.sign((c.vx||1)):0), weatherGrip);
    const frontContact=resolveGroundPoint(c,acc,frontAnchor,CONFIG.car.wheelRadius,1120,78,.88,
      distributedDrive-(frontNear?brakePower*Math.sign((c.vx||1)):0), weatherGrip);

    // Kadłub ma łagodne kontakty ochronne. Nie przyklejają auta do zbocza,
    // tylko uniemożliwiają wejście nosa lub podwozia pod powierzchnię.
    const hullPoints=[
      bodyPoint(c, CONFIG.car.bodyWidth*.50, CONFIG.car.bodyHeight*.05),
      bodyPoint(c, CONFIG.car.bodyWidth*.45, CONFIG.car.bodyHeight*.30),
      bodyPoint(c, 0,                         CONFIG.car.bodyHeight*.36),
      bodyPoint(c,-CONFIG.car.bodyWidth*.40, CONFIG.car.bodyHeight*.28)
    ];
    let hullContact=false;
    for(const hp of hullPoints){
      hp.rx=hp.x-c.x;hp.ry=hp.y-c.y;
      const hit=resolveGroundPoint(c,acc,hp,1.5,1450,92,.62,0);
      hullContact=hullContact||hit.contact;
    }

    const wheelContacts=(rearContact.contact?1:0)+(frontContact.contact?1:0);
    c.grounded=wheelContacts>0;

    // Sterowanie przechyłem działa przede wszystkim w locie. Przy jednym kole
    // na ziemi pozostaje słabsze, aby gracz mógł ratować pozycję bez teleportów.
    const airControl=wheelContacts===0?1:(wheelContacts===1?.34:0);
    acc.torque+=tilt*CONFIG.car.airTorque*airControl;
    if(wheelContacts===0&&weather.wind>.02){
      acc.ax+=weather.windDirection*weather.wind*(34+Math.min(90,Math.abs(c.vy)*.10));
      acc.torque+=weather.windDirection*weather.wind*.10;
    }

    // Opór ruchu zależny od kontaktu. Bez gazu auto nie cofa się samo.
    const drag=wheelContacts?0.99915:0.99962;
    c.vx*=Math.pow(drag,h*60);
    c.vy*=Math.pow(wheelContacts?.9985:.9997,h*60);
    c.angularVelocity*=Math.pow(wheelContacts?.982:.992,h*60);
    if(!throttle&&!brake&&wheelContacts>0&&Math.abs(c.vx)<12)c.vx+=(0-c.vx)*Math.min(1,h*5.2);

    c.vx+=acc.ax*h;c.vy+=acc.ay*h;
    c.angularVelocity+=acc.torque*h;
    c.angularVelocity=Math.max(-CONFIG.car.maxAngularVelocity,Math.min(CONFIG.car.maxAngularVelocity,c.angularVelocity));

    // Limity dotyczą prędkości wzdłuż kierunku auta, ale nie zmieniają jej skokowo.
    const forward=c.vx*Math.cos(c.angle)+c.vy*Math.sin(c.angle);
    const limit=nitroActive?CONFIG.speed.nitroLimit:CONFIG.speed.cruiseLimit;
    if(Math.abs(forward)>limit){
      const excess=Math.abs(forward)-limit;
      const release=excess*Math.min(1,h*(nitroActive?.08:CONFIG.speed.overspeedRelease));
      c.vx-=Math.sign(forward)*Math.cos(c.angle)*release;
      c.vy-=Math.sign(forward)*Math.sin(c.angle)*release;
    }

    c.x+=c.vx*h;c.y+=c.vy*h;c.angle+=c.angularVelocity*h;
    c.forwardSpeed=c.vx*Math.cos(c.angle)+c.vy*Math.sin(c.angle);

    // Koła są wizualizowane niezależnie. Koło z kontaktem siedzi na nawierzchni,
    // a drugie pozostaje przy swoim punkcie zawieszenia i może wisieć w powietrzu.
    const rearAfter=wheelAnchorWorld(c,CONFIG.car.rearWheelX);
    const frontAfter=wheelAnchorWorld(c,CONFIG.car.frontWheelX);
    const rearFloor=terrainY(rearAfter.x)-CONFIG.car.wheelRadius;
    const frontFloor=terrainY(frontAfter.x)-CONFIG.car.wheelRadius;
    c.wheels[0].x=rearAfter.x;c.wheels[0].y=Math.min(rearAfter.y,rearFloor);c.wheels[0].grounded=rearContact.contact;
    c.wheels[1].x=frontAfter.x;c.wheels[1].y=Math.min(frontAfter.y,frontFloor);c.wheels[1].grounded=frontContact.contact;
    for(const w of c.wheels)w.spin+=Math.hypot(c.vx,c.vy)/CONFIG.car.wheelRadius*h*(w.grounded?1:.45);

    if(!c.grounded){
      if(wasGrounded){c.airtime=.001;c.airStartY=c.y;c.airRotation=0;c.lastAirAngle=c.angle;}
      c.airtime+=h;c.maxFallSpeed=Math.max(c.maxFallSpeed,c.vy);
      c.airRotation+=Math.abs(normalizeAngle(c.angle-c.lastAirAngle));c.lastAirAngle=c.angle;
    }else if(!wasGrounded){
      const slope=(rearContact.contact&&frontContact.contact)?
        Math.atan2(frontContact.y-rearContact.y,frontContact.x-rearContact.x):
        (rearContact.contact?rearContact.slope:frontContact.slope);
      const nx=Math.sin(slope),ny=-Math.cos(slope);
      const impact=Math.max(0,-(c.vx*nx+c.vy*ny));
      finishLanding(c,impact);
    }

    if(updateHeadSensor(c,h))return;
    applyTunnelCeilingCollision(c);
  }

  if(nitroActive&&throttle&&Math.random()<dt*38) burst(c.x-88,c.y-10,1,'fire');
  // Efekty uszkodzeń są proceduralne, więc nie zależą od ładowania dodatkowych plików.
  if(state.health<48){
    const intensity=(48-state.health)/48;
    if(Math.random()<dt*(5+intensity*18)){
      const exhaust=bodyPoint(c,-32,-CONFIG.car.bodyHeight*.58);
      state.particles.push({x:exhaust.x+(Math.random()-.5)*16,y:exhaust.y,vx:(Math.random()-.5)*26,vy:-45-Math.random()*55,life:.5+Math.random()*.55,maxLife:1,size:5+Math.random()*8,kind:state.health<28&&Math.random()>.35?'damageFire':'smoke'});
    }
  }
  state.stuntPulse=Math.max(0,state.stuntPulse-dt*3.4);
  // Kamera v37: jeden płynny model zamiast przełączania pomiędzy osobnymi
  // zachowaniami dla jazdy, wybicia i spadania. To usuwa skoki przy zmianie grounded.
  const groundUnderCar=terrainY(c.x);
  const altitude=Math.max(0,groundUnderCar-c.y);
  const altitudeBlend=smootherstep(altitude/760);
  const speedBlend=smootherstep(Math.max(0,Math.abs(c.vx)-300)/620);

  // Analiza szerokiego fragmentu trasy. Duża góra lub głęboka dolina powoduje
  // łagodne oddalenie, ale nie przesuwa gwałtownie pionowej osi kamery.
  const reliefOffsets=[-520,-260,0,260,520,820,1120];
  let terrainMin=Infinity,terrainMax=-Infinity;
  for(const offset of reliefOffsets){
    const y=terrainY(c.x+offset);
    terrainMin=Math.min(terrainMin,y);
    terrainMax=Math.max(terrainMax,y);
  }
  const terrainRelief=terrainMax-terrainMin;
  const reliefBlend=smootherstep(Math.max(0,terrainRelief-170)/560);
  const airborneBlend=smootherstep(Math.min(1,c.airtime/.42));

  // Świat jest odrobinę bardziej oddalony. Auto ma niezależną kompensację skali
  // w drawCar(), więc pozostaje czytelne mimo większego pola widzenia.
  const cameraBiome=biomeMixAt(Math.max(0,c.x-250));
  const biomeZoom=mixNum(cameraBiome.a.camera,cameraBiome.b.camera,cameraBiome.t);
  const targetZoom=baseCameraZoom()*biomeZoom*(.92-.18*altitudeBlend-.06*speedBlend-.15*reliefBlend);
  const zoomRate=targetZoom<state.cameraZoom?2.1:1.05;
  // Ograniczenie oddalenia zapobiega odsłanianiu boków świata i zbyt małemu renderowi.
  const minZoom=Math.max(.48,baseCameraZoom()*.68);
  state.cameraZoom+=(Math.max(minZoom,targetZoom)-state.cameraZoom)*Math.min(1,dt*zoomRate);
  const zoomNow=state.cameraZoom;

  // Auto pozostaje po lewej stronie, aby pokazywać więcej trasy przed nim.
  const desiredCarX=canvas.width*(.265-.018*airborneBlend);
  const worldOffsetX=canvas.width*.5+(desiredCarX-canvas.width*.5)/zoomNow;
  const lookAhead=Math.max(0,c.vx-150)*(.16+.10*airborneBlend);
  const targetCamera=c.x-worldOffsetX+lookAhead;

  // Linia nawierzchni jest domyślnie bardzo nisko. Teren zajmuje zwykle około
  // 14–21% wysokości ekranu, zamiast dominować nad niebem.
  const desiredSurfaceY=canvas.height*(.865-.025*reliefBlend);
  const surfaceOffset=canvas.height*.5+(desiredSurfaceY-canvas.height*.5)/zoomNow;
  const groundCameraY=groundUnderCar-surfaceOffset;

  // W locie kamera podąża za środkiem pomiędzy autem a przewidywanym lądowaniem.
  // Używamy ciągłego airborneBlend, więc wybicie i lądowanie nie przełączają celu skokowo.
  const flightTime=Math.min(1.65,Math.max(.35,(Math.max(0,c.vy)+270)/430));
  const landingX=c.x+Math.max(0,c.vx)*flightTime;
  const landingY=terrainY(landingX);
  const desiredAirCarY=canvas.height*.44;
  const carOffsetY=canvas.height*.5+(desiredAirCarY-canvas.height*.5)/zoomNow;
  const carCameraY=c.y-carOffsetY;
  const landingCameraY=landingY-surfaceOffset;
  const flightCameraY=carCameraY*.60+landingCameraY*.40;
  let targetCameraY=groundCameraY*(1-airborneBlend)+flightCameraY*airborneBlend;

  // Miękki bezpieczny pas. Zamiast natychmiastowego przeskoku przesuwamy cel,
  // a sprężyna poniżej nadrabia różnicę bez szarpnięcia.
  const predictedCarScreenY=canvas.height*.5+(c.y-targetCameraY-canvas.height*.5)*zoomNow;
  const safeTop=canvas.height*.16;
  const safeBottom=canvas.height*.78;
  if(predictedCarScreenY<safeTop){
    targetCameraY+= (predictedCarScreenY-safeTop)/zoomNow;
  }else if(predictedCarScreenY>safeBottom){
    targetCameraY+= (predictedCarScreenY-safeBottom)/zoomNow;
  }

  state.cameraX+=(targetCamera-state.cameraX)*Math.min(1,dt*2.65);

  // Krytycznie tłumiona sprężyna pionowa. Jedna prędkość kamery przechodzi przez
  // wybicie, lot i lądowanie, dlatego nie ma nagłej zmiany kierunku ani pozycji.
  const stiffness=airborneBlend>.12?24:18;
  const damping=airborneBlend>.12?10.5:9.0;
  const errorY=targetCameraY-state.cameraY;
  state.cameraVY+=(errorY*stiffness-state.cameraVY*damping)*dt;
  const maxCameraSpeed=(airborneBlend>.12?920:560)/zoomNow;
  state.cameraVY=Math.max(-maxCameraSpeed,Math.min(maxCameraSpeed,state.cameraVY));
  state.cameraY+=state.cameraVY*dt;

  // Awaryjna korekta jest również płynna: dodaje impuls do prędkości, zamiast
  // teleportować kamerę. Działa tylko przy samym brzegu ekranu.
  const actualCarScreenY=canvas.height*.5+(c.y-state.cameraY-canvas.height*.5)*zoomNow;
  const emergencyTop=canvas.height*.07;
  const emergencyBottom=canvas.height*.91;
  if(actualCarScreenY<emergencyTop){
    state.cameraVY+=(actualCarScreenY-emergencyTop)*7.5/zoomNow;
  }else if(actualCarScreenY>emergencyBottom){
    state.cameraVY+=(actualCarScreenY-emergencyBottom)*7.5/zoomNow;
  }
  state.distance=Math.max(state.distance,Math.floor((c.x-250)/10));
  state.score=Math.max(state.score,state.distance*10+state.coins*100+(state.level-1)*500+state.bonusScore);
  if(state.score>state.record){state.record=state.score;localStorage.setItem('warszawiakRecord',String(state.record));}
  state.fuel-=(.54+state.level*.035+Math.abs(c.vx)/1100+(nitroActive?1.15:0))*dt;
  while(state.nextSpawnX<state.cameraX+3400)spawnObjectGroup();
  state.objects=state.objects.filter(o=>o.active&&o.x>state.cameraX-500);
  checkCollisions();
  if(state.time>state.multiplierUntil)state.multiplier=1;
  if(state.fuel<=0)endGame('Skończyło się paliwo');
  if(state.health<=0)endGame('Auto zostało zniszczone');
  if(c.y>terrainY(c.x)+CONFIG.world.fallLimit)endGame('Auto spadło poza trasę');
  updateHud();
}

function checkCollisions() {
  const c = state.car;
  for (const o of state.objects) {
    const dx = o.x - c.x, dy = o.y - c.y;
    const radius = o.size * .43 + 48;
    if (dx * dx + dy * dy > radius * radius) continue;
    o.active = false;
    if (o.type === 'chip') { state.coins += state.multiplier; state.score += 100 * state.multiplier; burst(o.x, o.y, 14, 'coin'); audio.coin(); }
    if (o.type === 'fuel') { state.fuel = Math.min(100, state.fuel + 30); burst(o.x, o.y, 14, 'fuel'); audio.fuel(); }
    if (o.type === 'repair') { state.health = Math.min(100, state.health + 28); state.score += 250; burst(o.x, o.y, 18, 'repair'); audio.repair(); }
    if (o.type === 'slot') { burst(o.x, o.y, 18, 'slot'); audio.slot(); startSlot(); }
  }
}

function weightedItem() {
  const total = ITEMS.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of ITEMS) { roll -= item.weight; if (roll <= 0) return item; }
  return ITEMS[0];
}
function startSlot() {
  if (state.slotting || state.over) return;
  state.slotting = true;
  ui.slotPanel.classList.remove('hidden');
  ui.slotResult.textContent = '';
  ui.slotCountdown.textContent = 'LOSOWANIE';
  const winner = weightedItem();
  const winnerIndex = 27;
  const sequence = Array.from({ length: 34 }, () => ITEMS[Math.floor(Math.random() * ITEMS.length)]);
  sequence[winnerIndex] = winner;
  ui.slotTrack.innerHTML = sequence.map(item => item.icon
    ? `<div class="slot-item" title="${item.label}"><img src="assets/${item.icon}" alt="${item.label}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="slot-fallback" style="display:none">${item.emoji}</span></div>`
    : `<div class="slot-item" title="${item.label}"><span class="slot-fallback slot-fallback-multiplier">${item.emoji}</span></div>`).join('');
  ui.slotTrack.style.transition = 'none';
  ui.slotTrack.style.transform = 'translateX(0px)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const windowEl = document.getElementById('slotWindow');
    const winnerEl = ui.slotTrack.children[winnerIndex];
    const windowWidth = windowEl.clientWidth;
    const target = winnerEl.offsetLeft + winnerEl.offsetWidth / 2 - windowWidth / 2 + (Math.random() * 5 - 2.5);
    ui.slotTrack.style.transition = 'transform 2.45s cubic-bezier(.08,.72,.12,1)';
    ui.slotTrack.style.transform = `translateX(${-target}px)`;
  }));
  state.slotEndRealTime = performance.now() + 2500;
  setTimeout(() => {
    if (state.over) return;
    applyItem(winner);
    audio.reward(!['damage','death'].includes(winner.type));
    ui.slotCountdown.textContent = winner.label;
    ui.slotResult.textContent = winner.result;
    setTimeout(() => { ui.slotPanel.classList.add('hidden'); state.slotting = false; }, winner.type === 'death' ? 300 : 1100);
  }, 2550);
}
function applyItem(item) {
  switch (item.type) {
    case 'nitro': audio.nitro(); state.boost = Math.min(100, state.boost + 25); state.nitroUntil = Math.max(state.nitroUntil, state.time) + 6; addNotification('NITRO • 6 s', '#67eaff', 4.8); break;
    case 'multiplier': state.multiplier = 2; state.multiplierUntil = Math.max(state.multiplierUntil, state.time) + 12; addNotification('MONETY x2 • 12 s', '#ffe36b', 4.8); break;
    case 'boost': state.car.vx = Math.min(CONFIG.speed.nitroLimit, Math.max(state.car.vx + 205, 500)); state.boostUntil = Math.max(state.boostUntil, state.time) + 4; addNotification('PRZYSPIESZENIE • 4 s', '#9de7ff', 4.8); break;
    case 'damage': audio.impact(.9); state.health = Math.max(0, state.health - 35); state.screenShake = 12; addNotification('USZKODZENIE −35%', '#ff776d', 4.8); break;
    case 'repair': audio.repair(); state.health = Math.min(100, state.health + 45); addNotification('NAPRAWA +45%', '#8effb1', 4.8); break;
    case 'death': endGame('Wylosowano ŚMIERĆ'); break;
  }
  updateHud();
}

function burst(x, y, count, kind) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 30 + Math.random() * 160;
    state.particles.push({ x, y, vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed - 40, life:.35+Math.random()*.55, maxLife:.9, size:3+Math.random()*7, kind });
  }
}
function updateParticles(dt) {
  if (!state) return;
  for (const p of state.particles) {
    p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt;
    p.vy += (p.kind === 'fire' || p.kind === 'damageFire' || p.kind === 'smoke' ? -30 : 380) * dt;
    p.vx *= Math.pow(.985, dt*60);
  }
  state.particles = state.particles.filter(p => p.life > 0);
}
function endGame(reason) {
  if (state.over) return;
  state.over = true; state.running = false;
  ui.reason.textContent = reason;
  ui.finalScore.textContent = Math.floor(state.score).toLocaleString('pl-PL');
  if (ui.finalDistance) ui.finalDistance.textContent = `${state.distance} m`;
  if (ui.finalCoins) ui.finalCoins.textContent = state.coins;
  if (ui.finalLevel) ui.finalLevel.textContent = state.level;
  if (ui.finalRecord) ui.finalRecord.textContent = Math.floor(state.record).toLocaleString('pl-PL');
  ui.over.classList.remove('hidden');
}
function drawNitroGauge(ratio) {
  const gauge = ui.nitroGauge;
  if (!gauge || typeof gauge.getContext !== 'function') return;

  const rect = gauge.getBoundingClientRect();
  const cssSize = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelSize = Math.max(1, Math.round(cssSize * dpr));
  if (gauge.width !== pixelSize || gauge.height !== pixelSize) {
    gauge.width = pixelSize;
    gauge.height = pixelSize;
  }

  const g = gauge.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssSize, cssSize);

  const center = cssSize / 2;
  const lineWidth = Math.max(5, cssSize * .055);
  const radius = Math.max(1, center - lineWidth / 2 - 2);
  const startAngle = -Math.PI / 2;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));

  // Stały tor pokazuje pełny zakres nitro.
  g.beginPath();
  g.arc(center, center, radius, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(93, 143, 171, .28)';
  g.lineWidth = lineWidth;
  g.lineCap = 'butt';
  g.stroke();

  // Łuk zawsze zaczyna się na godzinie 12 i skraca zgodnie z ruchem wskazówek.
  if (safeRatio > .001) {
    const gradient = g.createLinearGradient(0, 0, cssSize, cssSize);
    gradient.addColorStop(0, '#72f7ff');
    gradient.addColorStop(.52, '#20c8ff');
    gradient.addColorStop(1, '#9a62ff');
    g.beginPath();
    g.arc(center, center, radius, startAngle, startAngle + Math.PI * 2 * safeRatio, false);
    g.strokeStyle = gradient;
    g.lineWidth = lineWidth;
    g.lineCap = safeRatio > .995 ? 'butt' : 'round';
    g.shadowColor = 'rgba(42, 217, 255, .75)';
    g.shadowBlur = Math.max(4, cssSize * .035);
    g.stroke();
    g.shadowBlur = 0;
  }
}

function renderActiveEffects() {
  if (!ui.activeEffects || !state) return;
  const effects = [];
  const timed = (until) => Math.max(0, until - state.time);
  if (timed(state.nitroUntil) > 0) effects.push({ type:'nitro', icon:'nitro.png', label:'NITRO', seconds:timed(state.nitroUntil) });
  if (timed(state.boostUntil) > 0) effects.push({ type:'boost', icon:'boost.png', label:'BOOST', seconds:timed(state.boostUntil) });
  if (state.multiplier > 1 && timed(state.multiplierUntil) > 0) effects.push({ type:'multiplier', icon:'multiplier.png', label:'MONETY x2', seconds:timed(state.multiplierUntil) });
  const signature = effects.map(e => `${e.type}:${Math.ceil(e.seconds)}`).join('|');
  if (ui.activeEffects.dataset.signature === signature) return;
  ui.activeEffects.dataset.signature = signature;
  ui.activeEffects.innerHTML = effects.map(effect => `
    <article class="effect-chip effect-${effect.type}">
      <img src="assets/${effect.icon}" alt="">
      <span>${effect.label}</span>
      <b>${Math.ceil(effect.seconds)} s</b>
      <i style="--remaining:${Math.max(0, Math.min(1, effect.seconds / (effect.type === 'multiplier' ? 12 : effect.type === 'nitro' ? 6 : 4)))}"></i>
    </article>`).join('');
  ui.activeEffects.classList.toggle('has-effects', effects.length > 0);
}

function validateSlotConfiguration() {
  const known = new Set(['nitro','multiplier','boost','damage','repair','death']);
  const errors = [];
  for (const item of ITEMS) {
    if (!known.has(item.type)) errors.push(`Nieznany typ: ${item.type}`);
    if (!(item.weight > 0)) errors.push(`Nieprawidłowa waga: ${item.type}`);
    if (!item.label || !item.result) errors.push(`Brak opisu: ${item.type}`);
  }
  if (new Set(ITEMS.map(i => i.type)).size !== ITEMS.length) errors.push('Powielony typ nagrody');
  if (errors.length) console.error('[v61] Błędy konfiguracji slotu:', errors);
  else console.info('[v61] Slot: 6/6 nagród zweryfikowanych.');
  return errors;
}
window.__slotDiagnostics = { validate: validateSlotConfiguration, items: ITEMS.map(({type,label,weight,result}) => ({type,label,weight,result})) };
validateSlotConfiguration();

function updateHud() {
  ui.score.textContent = state.score;
  ui.distance.textContent = `${state.distance} m`;

  const now = performance.now();
  const hudDt = Math.min(.10, Math.max(1 / 240, (now - (state.hudSpeedAt || now)) / 1000));
  state.hudSpeedAt = now;

  const c = state.car;
  // Na ziemi forwardSpeed jest jedyną miarodajną prędkością jazdy. W locie
  // korzystamy z poziomej składowej vx, aby spadanie nie zawyżało licznika.
  const rawSpeed = Math.max(0, Math.abs(c.grounded
    ? (Number.isFinite(c.forwardSpeed) ? c.forwardSpeed : 0)
    : (Number.isFinite(c.vx) ? c.vx : 0)));

  const nitroFromKey = keys.has(' ') && state.boost > 0;
  const nitroFromSlot = state.time < state.nitroUntil;
  const nitroNow = nitroFromKey || nitroFromSlot;
  const temporaryBoost = state.time < state.boostUntil;

  // Jedna, fizyczna skala dla całego licznika. Nie zmieniamy przelicznika
  // po włączeniu nitro — większa wartość wynika wyłącznie z realnej prędkości auta.
  const unitsToKmh = CONFIG.speed.displayCruise / CONFIG.speed.cruiseLimit;
  const displayTarget = rawSpeed * unitsToKmh;

  if (!Number.isFinite(state.hudSpeed)) state.hudSpeed = 0;
  // Wygładzenie zależne od czasu: licznik nadąża bez skoków, ale nie jest ospały.
  const tau = displayTarget > state.hudSpeed ? .22 : .14;
  const follow = 1 - Math.exp(-hudDt / tau);
  state.hudSpeed += (displayTarget - state.hudSpeed) * follow;
  if (displayTarget < .2 && state.hudSpeed < .5) state.hudSpeed = 0;

  const gaugeMax = CONFIG.speed.displayNitro;
  const shownSpeed = Math.round(Math.max(0, Math.min(gaugeMax, state.hudSpeed)));
  ui.speed.textContent = String(shownSpeed);
  if (ui.speedArc) {
    ui.speedArc.style.setProperty('--speed-fill', `${(shownSpeed / gaugeMax) * 256}deg`);
  }

  if (ui.speedArc) {
    ui.speedArc.classList.toggle('nitro-active', nitroNow || temporaryBoost);
    ui.speedArc.classList.toggle('fast', shownSpeed >= 350);
  }

  const boostRatio = Math.max(0, Math.min(1, Number(state.boost) / 100));
  drawNitroGauge(boostRatio);

  if (ui.speedMode) {
    ui.speedMode.textContent = nitroNow ? 'NITRO' : (temporaryBoost ? 'BOOST' : 'LIMIT');
  }
  ui.level.textContent = state.level;
  state.hudCoins += (state.coins - state.hudCoins) * Math.min(1, hudDt * 10);
  ui.coins.textContent = String(Math.round(state.hudCoins));
  if (ui.record) ui.record.textContent = Math.floor(state.record).toLocaleString('pl-PL');
  const fuel = Math.max(0, Math.ceil(state.fuel)), health = Math.max(0, Math.ceil(state.health));
  ui.fuelText.textContent = `${fuel}%`; ui.fuelBar.style.width = `${fuel}%`;
  ui.healthText.textContent = `${health}%`; ui.healthBar.style.width = `${health}%`;
  const boost = Math.max(0, Math.ceil(state.boost));
  if (ui.boostText) ui.boostText.textContent = '';
  if (ui.boostBar) ui.boostBar.style.width = `${boost}%`;
  const activeLabels = [];
  if (nitroNow) activeLabels.push('NITRO');
  if (temporaryBoost) activeLabels.push('BOOST');
  if (state.multiplier > 1) activeLabels.push('MONETY x2');
  // Górna karta BONUS pozostaje kompaktowa. Szczegóły i czasy są pokazywane
  // w osobnych kartach aktywnych efektów, więc nie upychamy kilku nazw w jednym polu.
  ui.effect.textContent = activeLabels.length === 0
    ? 'BRAK'
    : activeLabels.length === 1
      ? activeLabels[0]
      : `${activeLabels[0]} +${activeLabels.length - 1}`;
  ui.effect.title = activeLabels.join(' + ');
  renderActiveEffects();
  document.querySelectorAll('[data-input]').forEach(el => el.classList.toggle('active', keys.has(el.dataset.input)));
  if (ui.gasPedal) ui.gasPedal.classList.toggle('pressed', keys.has('w'));
  if (ui.brakePedal) ui.brakePedal.classList.toggle('pressed', keys.has('s'));
  if (ui.inputAction) {
    const actions=[];
    if(keys.has('w')) actions.push('GAZ'); if(keys.has('s')) actions.push('HAMULEC');
    if(keys.has('a')) actions.push('OBRÓT W LEWO'); if(keys.has('d')) actions.push('OBRÓT W PRAWO');
    if(keys.has(' ')) actions.push('NITRO');
    ui.inputAction.textContent = actions.length ? actions.join(' + ') : 'OCZEKIWANIE';
  }
}

function ready(img) { return img.complete && img.naturalWidth > 0; }
function drawContain(img, x, y, maxW, maxH, anchorX=.5, anchorY=.5) {
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  ctx.drawImage(img, x - w * anchorX, y - h * anchorY, w, h);
  return { w, h };
}

const CROP = {
  car: {x:0,y:0,w:714,h:216},
  carDamaged: {x:0,y:0,w:726,h:290},
  // Nowa opona 1024×1024 — rzeczywista grafika znajduje się w tym obszarze alfa.
  wheel: {x:104,y:56,w:812,h:792},
  carShadow: {x:0,y:0,w:520,h:40},
  chip: {x:0,y:0,w:192,h:191},
  fuel: {x:0,y:0,w:192,h:202},
  // Nowe kasynko 1024×1024 — poprzedni crop wycinał tylko pusty lewy górny róg.
  slot: {x:68,y:17,w:884,h:993}
};
function drawCropped(img,crop,x,y,w,h,anchorX=.5,anchorY=.5){
  ctx.drawImage(img,crop.x,crop.y,crop.w,crop.h,x-w*anchorX,y-h*anchorY,w,h);
}

function draw() {
  if (!state) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const shakeX = state.screenShake ? (Math.random() - .5) * state.screenShake : 0;
  const shakeY = state.screenShake ? (Math.random() - .5) * state.screenShake : 0;
  state.screenShake *= .86;
  // Tło zawsze wypełnia cały ekran. Zoom dotyczy świata, dzięki czemu nie powstają czarne pasy.
  drawBackground();
  ctx.save();
  ctx.translate(shakeX, shakeY);
  const zoom = cameraZoom();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-canvas.width / 2, -canvas.height / 2);
  drawFarHills();
  drawTunnelCeiling();
  drawTerrain();
  drawObjects();
  drawParticles();
  drawCar();
  ctx.restore();
  drawWeather(weatherAt(Math.max(0,state.car.x-250)));
  drawLevelLighting();
  drawStuntHud();
}

function drawLevelLighting(){
  const distance=Math.max(0,state.car.x-250);
  const climate=climateMixAt(distance);
  const tint=lerpColor(climate.a.tint,climate.b.tint,climate.t);
  const alpha=mixNum(climate.a.tintAlpha,climate.b.tintAlpha,climate.t);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  const glow=ctx.createLinearGradient(0,0,0,canvas.height);
  glow.addColorStop(0,tint);
  glow.addColorStop(.58,'rgba(255,255,255,0)');
  glow.addColorStop(1,tint);
  ctx.globalCompositeOperation='screen';
  ctx.globalAlpha=alpha;
  ctx.fillStyle=glow;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // Krótka adaptacja światła po wejściu w nowy klimat. Bez bannerów i bez ciemnych overlayów.
  if(distance>1200){
    const fromBoundary=Math.min(climate.local,CLIMATE_LENGTH-climate.local);
    const pulse=1-smootherstep(Math.min(1,fromBoundary/1100));
    if(pulse>0){
      ctx.globalCompositeOperation='screen';
      ctx.globalAlpha=pulse*.045;
      ctx.fillStyle='#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
    }
  }
  ctx.restore();
}

function drawStuntHud() {
  if (!state || !state.car) return;
  const c = state.car;
  const hasAirInfo = !c.grounded && c.airtime > .18;
  const hasCombo = state.stuntMultiplier > 1.001 || state.stuntChain > 0;
  const visibleNotifications = state.notifications.filter(n => n.life > 0).slice(0, 3);
  if (!hasAirInfo && !hasCombo && visibleNotifications.length === 0) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Panel zawsze zaczyna się pod lewym górnym HUD-em. Pozycja jest liczona
  // z rzeczywistego rozmiaru elementu HTML, więc nie nachodzi na paliwo/stan/bonus.
  const statusRect = document.querySelector('.vehicle-status')?.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, window.innerWidth);
  const scaleY = canvas.height / Math.max(1, window.innerHeight);
  const x = Math.max(14, 16 * scaleX);
  const hudBottom = statusRect ? statusRect.bottom * scaleY : (canvas.width <= 640 ? 76 : 88);
  const y = Math.max(82, hudBottom + 12 * scaleY);

  const compact = canvas.width < 760;
  const panelW = compact ? 176 : 210;
  const panelH = compact ? 58 : 68;
  const pulseEase = Math.max(0, Math.min(1, state.stuntPulse)) ** 2;
  const scale = 1 + pulseEase * .045;

  ctx.save();
  ctx.translate(x + panelW * .5, y + panelH * .5);
  ctx.scale(scale, scale);
  ctx.translate(-panelW * .5, -panelH * .5);

  const panelGradient = ctx.createLinearGradient(0, 0, panelW, panelH);
  panelGradient.addColorStop(0, 'rgba(9,31,55,.88)');
  panelGradient.addColorStop(1, 'rgba(13,55,78,.80)');
  ctx.beginPath();
  ctx.roundRect(0, 0, panelW, panelH, 15);
  ctx.fillStyle = panelGradient;
  ctx.shadowColor = 'rgba(0,0,0,.26)';
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.roundRect(.75, .75, panelW - 1.5, panelH - 1.5, 14);
  ctx.strokeStyle = 'rgba(197,239,255,.28)';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Mała proceduralna ikona płomienia — bez zewnętrznego sprite'a.
  const iconX = compact ? 22 : 25;
  const iconY = panelH * .52;
  ctx.save();
  ctx.translate(iconX, iconY);
  ctx.scale(.78 + pulseEase * .08, .78 + pulseEase * .08);
  const flame = ctx.createLinearGradient(0, -16, 0, 15);
  flame.addColorStop(0, '#fff29a');
  flame.addColorStop(.48, '#ff9a30');
  flame.addColorStop(1, '#ed4932');
  ctx.fillStyle = flame;
  ctx.shadowColor = 'rgba(255,126,38,.58)';
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.bezierCurveTo(11, -6, 12, 6, 4, 14);
  ctx.bezierCurveTo(-2, 19, -12, 12, -11, 3);
  ctx.bezierCurveTo(-10, -3, -4, -7, 0, -17);
  ctx.fill();
  ctx.restore();

  const textX = compact ? 43 : 49;
  ctx.fillStyle = 'rgba(218,241,255,.76)';
  ctx.font = `800 ${compact ? 8 : 9}px system-ui`;
  ctx.fillText('KOMBO POWIETRZNE', textX, compact ? 19 : 21);
  ctx.fillStyle = '#fff';
  ctx.font = `1000 ${compact ? 23 : 27}px system-ui`;
  ctx.fillText(`x${state.stuntMultiplier.toFixed(1)}`, textX, compact ? 47 : 54);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(194,226,242,.82)';
  ctx.font = `850 ${compact ? 8 : 9}px system-ui`;
  ctx.fillText(`${state.stuntChain} TRIKÓW`, panelW - 12, compact ? 45 : 51);
  ctx.restore();

  let feedY = y + panelH + 8;
  if (hasAirInfo) {
    const rotations = Math.abs(c.airRotation || 0);
    const flips = Math.floor(rotations / (Math.PI * 2));
    const progress = (rotations % (Math.PI * 2)) / (Math.PI * 2);
    const infoW = panelW;
    const infoH = compact ? 36 : 40;
    ctx.beginPath();
    ctx.roundRect(x, feedY, infoW, infoH, 10);
    ctx.fillStyle = 'rgba(7,25,45,.74)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${compact ? 11 : 12}px system-ui`;
    const label = flips ? `${flips}× PIRUET  •  ${c.airtime.toFixed(1)} s` : `LOT  •  ${c.airtime.toFixed(1)} s`;
    ctx.fillText(label, x + 11, feedY + (compact ? 15 : 17));
    const bx = x + 11, by = feedY + infoH - 10, bw = infoW - 22, bh = 5;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 3); ctx.fillStyle = 'rgba(1,13,28,.65)'; ctx.fill();
    if (progress > .002) {
      ctx.beginPath(); ctx.roundRect(bx, by, bw * progress, bh, 3); ctx.fillStyle = '#66dcff'; ctx.fill();
    }
    feedY += infoH + 7;
  }

  // Każdy komunikat ma własny chip. Ograniczenie do trzech pozycji zapobiega
  // nakładaniu tekstu przy szybkich seriach monet/trików.
  visibleNotifications.forEach((n, i) => {
    const enter = smootherstep(Math.max(0, Math.min(1, (n.age || 0) / .32)));
    const exit = smootherstep(Math.max(0, Math.min(1, n.life / 1.05)));
    const alpha = enter * exit;
    const chipY = feedY + i * (compact ? 27 : 30) + (1 - enter) * 8 - (1 - exit) * 4;
    const chipH = compact ? 22 : 25;
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${compact ? 11 : 12}px system-ui`;
    const textW = Math.min(panelW - 18, ctx.measureText(n.text).width + 22);
    ctx.beginPath();
    ctx.roundRect(x, chipY, Math.max(92, textW), chipH, 10);
    const chipGradient = ctx.createLinearGradient(x, chipY, x + Math.max(92, textW), chipY + chipH);
    chipGradient.addColorStop(0, 'rgba(10,35,59,.88)');
    chipGradient.addColorStop(1, 'rgba(7,23,42,.78)');
    ctx.fillStyle = chipGradient;
    ctx.shadowColor = 'rgba(0,0,0,.24)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(201,239,255,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = n.color;
    ctx.fillText(n.text, x + 11, chipY + (compact ? 15 : 17));
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}
function drawCover(img) {
  const scale=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
  const w=img.naturalWidth*scale,h=img.naturalHeight*scale;
  ctx.drawImage(img,(canvas.width-w)*.5,(canvas.height-h)*.5,w,h);
}
function drawTiledParallax(img, speed, bottomY, targetHeight, alpha=1, verticalFactor=.02) {
  if(!ready(img)) return;
  const scale=targetHeight/img.naturalHeight;
  const h=targetHeight;
  const w=img.naturalWidth*scale;
  const worldShift=state.cameraX*speed;
  const firstIndex=Math.floor(worldShift/w)-2;
  const vertical=Math.max(-36,Math.min(36,(state.cameraY-CONFIG.world.baseline)*verticalFactor));
  const y=Math.floor(bottomY-h-vertical);
  ctx.save();
  ctx.globalAlpha=alpha;
  // Naprzemienne odbicie sprawia, że sąsiadujące krawędzie są identyczne.
  // Usuwa pionowe szwy bez rozmywania PNG ani skalowania całego tła.
  for(let i=firstIndex;i<firstIndex+Math.ceil(canvas.width/w)+5;i++){
    const x=Math.floor(i*w-worldShift);
    ctx.save();
    if(i&1){
      ctx.translate(x+w,0);
      ctx.scale(-1,1);
      ctx.drawImage(img,0,y,Math.ceil(w)+1,Math.ceil(h)+1);
    }else{
      ctx.drawImage(img,x,y,Math.ceil(w)+1,Math.ceil(h)+1);
    }
    ctx.restore();
  }
  ctx.restore();
}
function cloudHash(n) {
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function drawCloudShape(x, y, scale, alpha, variant=0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  const forms = [
    [[-82,3,47,35],[-42,-28,62,57],[18,-43,57,69],[72,-12,54,48],[110,10,34,25]],
    [[-102,8,39,26],[-63,-13,48,42],[-16,-34,63,54],[43,-22,50,48],[88,5,45,31]],
    [[-73,9,40,29],[-32,-16,49,45],[8,-51,58,69],[57,-30,61,58],[105,5,38,29]],
    [[-116,12,35,22],[-78,-5,44,35],[-30,-27,54,49],[22,-20,49,45],[69,-4,46,35],[110,12,31,21]]
  ];
  const lobes=forms[variant%forms.length];
  ctx.fillStyle='rgba(57,133,199,.18)';
  ctx.beginPath();ctx.ellipse(0,18,132,27,0,0,Math.PI*2);
  for(const [lx,ly,rx,ry] of lobes)ctx.ellipse(lx,ly+10,rx,ry,0,0,Math.PI*2);
  ctx.fill();

  const g=ctx.createLinearGradient(0,-85,0,42);
  g.addColorStop(0,'rgba(255,255,255,.995)');
  g.addColorStop(.58,'rgba(247,252,255,.985)');
  g.addColorStop(1,'rgba(194,227,247,.965)');
  ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,10,136,31,0,0,Math.PI*2);
  for(const [lx,ly,rx,ry] of lobes)ctx.ellipse(lx,ly,rx,ry,0,0,Math.PI*2);
  ctx.fill();

  ctx.globalAlpha*=.22;ctx.fillStyle='white';ctx.beginPath();
  ctx.ellipse(-18,-50,60,17,-.12,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function drawCloudBand(parallax, baseY, spacing, minScale, maxScale, alpha, seed, drift=4) {
  // Niezależny, powolny wiatr plus delikatny parallax.
  const shift = state.cameraX * parallax + state.time * drift;
  const first = Math.floor(shift / spacing) - 2;
  const count = Math.ceil(canvas.width / spacing) + 5;
  for (let i = first; i < first + count; i++) {
    const r1 = cloudHash(i * 31 + seed);
    const r2 = cloudHash(i * 47 + seed * 3);
    const r3 = cloudHash(i * 59 + seed * 7);
    const x = i * spacing - shift + (r1 - .5) * spacing * .34;
    const y = baseY + (r2 - .5) * canvas.height * .14;
    const scale = minScale + (maxScale - minScale) * r3;
    drawCloudShape(x, y, scale, alpha, Math.floor(r1*4));
  }
}
function parseColor(value){
  if(typeof value!=='string') return [108,201,255];
  if(value[0]==='#'){
    let hex=value.slice(1);
    if(hex.length===3) hex=hex.split('').map(ch=>ch+ch).join('');
    const n=Number.parseInt(hex,16);
    if(Number.isFinite(n)) return [(n>>16)&255,(n>>8)&255,n&255];
  }
  const m=value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return m ? [Number(m[1]),Number(m[2]),Number(m[3])] : [108,201,255];
}
function lerpColor(a,b,t){
  const [ar,ag,ab]=parseColor(a),[br,bg,bb]=parseColor(b);
  const k=Math.max(0,Math.min(1,Number.isFinite(t)?t:0));
  const r=Math.round(ar+(br-ar)*k),g=Math.round(ag+(bg-ag)*k),bl=Math.round(ab+(bb-ab)*k);
  return `rgb(${r},${g},${bl})`;
}
function drawBackground() {
  const distance=Math.max(0,state.car.x-250), bm=biomeMixAt(distance), climate=climateMixAt(distance), weather=weatherAt(distance);
  const meters=distance/10;
  const dayCycle=32000; // bardzo długa, subtelna zmiana barwy nieba
  const phase=(meters%dayCycle)/dayCycle;
  // Jasny Miami Vice vibe przez cały cykl: turkus, róż i brzoskwinia, bez nocy.
  const dayStops=[
    {p:0,c:['#5b8cff','#86ddf4','#ffe6cb']},
    {p:.18,c:['#159ce5','#56d6ec','#f7fbdf']},
    {p:.55,c:['#17a7e8','#65d9ed','#fff2c9']},
    {p:.72,c:['#7765df','#ef78bb','#ffbf86']},
    {p:.88,c:['#567fe8','#e482ce','#ffd3a4']},
    {p:1,c:['#5b8cff','#86ddf4','#ffe6cb']}
  ];
  let da=dayStops[0],db=dayStops[1];
  for(let i=0;i<dayStops.length-1;i++)if(phase>=dayStops[i].p&&phase<=dayStops[i+1].p){da=dayStops[i];db=dayStops[i+1];break;}
  const dt=smootherstep((phase-da.p)/(db.p-da.p||1));
  const dayCols=da.c.map((c,i)=>lerpColor(c,db.c[i],dt));
  const biomeCols=bm.a.sky.map((c,i)=>lerpColor(c,bm.b.sky[i],bm.t));
  const climateCols=climate.a.sky.map((c,i)=>lerpColor(c,climate.b.sky[i],climate.t));
  const evening=smootherstep((phase-.68)/.20);
  const biomeInfluence=.24-.05*evening;
  let cols=dayCols.map((c,i)=>lerpColor(c,biomeCols[i],biomeInfluence));
  // Klimat jest głównym wizualnym wyróżnikiem, ale zachowuje Miami Vice charakter gry.
  cols=cols.map((c,i)=>lerpColor(c,climateCols[i],.68));
  const stormShade=Math.max(weather.storm*.38,weather.rain*.13);
  if(stormShade>0){const stormCols=['#50658f','#7d8db1','#b6b6c7'];cols=cols.map((c,i)=>lerpColor(c,stormCols[i],stormShade));}
  const sky=ctx.createLinearGradient(0,0,0,canvas.height);sky.addColorStop(0,cols[0]);sky.addColorStop(.58,cols[1]);sky.addColorStop(1,cols[2]);ctx.fillStyle=sky;ctx.fillRect(0,0,canvas.width,canvas.height);

  const climateDensity=mixNum(climate.a.cloudDensity,climate.b.cloudDensity,climate.t);
  const climateScale=mixNum(climate.a.cloudScale,climate.b.cloudScale,climate.t);
  const climateSpeed=mixNum(climate.a.cloudSpeed,climate.b.cloudSpeed,climate.t);
  const cloudAmount=mixNum(bm.a.cloud,bm.b.cloud,bm.t)*climateDensity*(1+weather.rain*.18+weather.storm*.24);
  const cloudMood=mixNum(bm.a.freq,bm.b.freq,bm.t);
  const biomeCloudScale=mixNum(
    bm.index===4?.82:bm.index===3?1.12:1,
    bm.index+1===4?.82:bm.index+1===3?1.12:1,
    bm.t
  );
  const cloudScale=biomeCloudScale*climateScale;
  const drift=mixNum(bm.a.atmosphere==='wind'?8.5:4.5,bm.b.atmosphere==='wind'?8.5:4.5,bm.t)*climateSpeed;
  drawCloudBand(.008,canvas.height*(bm.index===2?.10:.14),Math.max(500,canvas.width*(.32/cloudMood)),.88*cloudScale,1.48*cloudScale,(.48-weather.storm*.10)*cloudAmount,17,drift);
  drawCloudBand(.017,canvas.height*(bm.index===3?.29:.35),Math.max(650,canvas.width*(.43/cloudMood)),.52*cloudScale,.98*cloudScale,(.27+weather.rain*.08)*cloudAmount,41,drift*.72);
  drawCloudBand(.003,canvas.height*.58,Math.max(900,canvas.width*(.60/cloudMood)),.38*cloudScale,.70*cloudScale,.14*cloudAmount,73,drift*.42);

  // Bez deszczu, pyłu, liści i innych nakładek. Biomy odróżniają się
  // światłem, chmurami, kolorystyką i profilem terenu.
  // Celowo bez dodatkowych liści, pyłu, smug i iskier. Różnice biomów
  // wynikają wyłącznie z terenu, nieba, chmur oraz kolorystyki podłoża.
  const haze=ctx.createLinearGradient(0,canvas.height*.55,0,canvas.height);haze.addColorStop(0,'rgba(255,255,255,0)');haze.addColorStop(1,`rgba(255,255,255,${.08-weather.storm*.035})`);ctx.fillStyle=haze;ctx.fillRect(0,canvas.height*.55,canvas.width,canvas.height*.45);
}

function drawWeather(weather){
  // Pogoda jest rysowana w przestrzeni ekranu, niezależnie od kamery i zoomu.
  // Dzięki temu opady zawsze pokrywają cały viewport, również na ultrawide.
  const rain=Math.max(0,Math.min(1,weather.rain||0));
  const snow=Math.max(0,Math.min(1,weather.snow||0));
  const wind=Math.max(0,Math.min(1,weather.wind||0));
  const width=canvas.width, height=canvas.height;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();

  if(rain>.015){
    ctx.save();
    ctx.lineCap='round';
    ctx.strokeStyle=`rgba(205,232,247,${.15+.42*rain})`;
    ctx.lineWidth=.9+rain*.9;
    // Liczba kropli zależy od powierzchni ekranu, nie tylko od szerokości.
    const density=(width*height)/(1920*1080);
    const count=Math.max(80,Math.floor((115+245*rain)*density));
    const slant=5+wind*13*weather.windDirection;
    for(let i=0;i<count;i++){
      const hx=cloudHash(i*83+terrainSeed*0.0001+19);
      const hy=cloudHash(i*97+terrainSeed*0.0003+31);
      const speed=560+cloudHash(i*19+13)*430;
      const drift=state.time*(95+wind*150)*weather.windDirection;
      const x=((hx*width+drift+i*23)%(width+180)+width+180)%(width+180)-90;
      const y=(hy*height+state.time*speed+i*11)%(height+140)-70;
      const len=11+rain*22+cloudHash(i*7)*10;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-slant,y+len);ctx.stroke();
    }
    ctx.restore();
  }

  if(snow>.015){
    ctx.save();
    ctx.fillStyle=`rgba(248,253,255,${.28+.52*snow})`;
    const density=(width*height)/(1920*1080);
    const count=Math.max(75,Math.floor((90+190*snow)*density));
    for(let i=0;i<count;i++){
      // Każdy płatek ma niezależną pozycję bazową na całej szerokości ekranu.
      const hx=cloudHash(i*71+terrainSeed*0.00011+7);
      const hy=cloudHash(i*91+terrainSeed*0.00017+17);
      const fall=22+cloudHash(i*3+5)*31;
      const lateral=(9+cloudHash(i*23+9)*19)*weather.windDirection;
      const x=((hx*width+state.time*lateral+i*29)%(width+80)+width+80)%(width+80)-40;
      const y=(hy*height+state.time*fall+i*13)%(height+70)-35;
      const sway=Math.sin(state.time*(.9+cloudHash(i*5)*.7)+i*1.71)*(5+snow*8);
      const r=1.1+cloudHash(i*13)*2.8;
      ctx.beginPath();ctx.arc(x+sway,y,r,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }

  // Silny wiatr ma własny, pełnoekranowy efekt. Smugi są szerokie i rzadkie,
  // dzięki czemu zjawisko jest czytelne, ale nie zasłania trasy ani HUD-u.
  if(wind>.018){
    ctx.save();
    const density=(width*height)/(1920*1080);
    const count=Math.max(16,Math.floor((18+30*wind)*Math.sqrt(density)));
    const dir=weather.windDirection||1;
    ctx.lineCap='round';
    ctx.lineWidth=.8+wind*1.15;
    for(let i=0;i<count;i++){
      const hx=cloudHash(i*113+terrainSeed*.00007+11);
      const hy=cloudHash(i*149+terrainSeed*.00009+23);
      const speed=150+cloudHash(i*31+5)*260+wind*180;
      const lane=70+cloudHash(i*43+9)*190;
      const travel=state.time*speed*dir;
      const x=((hx*(width+lane)+travel+i*67)%(width+lane*2)+(width+lane*2))%(width+lane*2)-lane;
      const y=hy*height;
      const length=35+cloudHash(i*17+3)*115+wind*80;
      const bend=(cloudHash(i*29+7)-.5)*18;
      const alpha=.025+wind*(.055+cloudHash(i*19)*.055);
      ctx.strokeStyle=`rgba(235,248,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.quadraticCurveTo(x-dir*length*.52,y+bend,x-dir*length,y+bend*.35);
      ctx.stroke();
    }
    // Bardzo lekki chłodny tint wzmacnia odczucie podmuchu.
    ctx.fillStyle=`rgba(205,232,247,${wind*.018})`;
    ctx.fillRect(0,0,width,height);
    ctx.restore();
  }

  if(weather.fog>.015){
    const fog=ctx.createLinearGradient(0,height*.08,0,height);
    fog.addColorStop(0,`rgba(226,238,244,${weather.fog*.045})`);
    fog.addColorStop(.52,`rgba(226,238,244,${weather.fog*.15})`);
    fog.addColorStop(1,`rgba(226,238,244,${weather.fog*.29})`);
    ctx.fillStyle=fog;ctx.fillRect(0,0,width,height);
  }
  if(weather.heat>.015){
    const heat=Math.max(0,Math.min(1,weather.heat));
    ctx.save();
    ctx.globalCompositeOperation='screen';
    ctx.fillStyle=`rgba(255,174,104,${heat*.055})`;
    ctx.fillRect(0,0,width,height);
    // Falujące pasma nad dolną częścią ekranu imitują gorące powietrze,
    // bez kosztownego filtrowania lub deformowania całego canvasa.
    ctx.globalCompositeOperation='source-over';
    ctx.lineWidth=1;
    const bands=7+Math.floor(heat*7);
    for(let i=0;i<bands;i++){
      const baseY=height*(.56+i/(bands+2)*.42);
      const phase=state.time*(.75+i*.035)+i*1.91;
      ctx.strokeStyle=`rgba(255,224,185,${.018+heat*.035})`;
      ctx.beginPath();
      for(let x=-20;x<=width+20;x+=26){
        const y=baseY+Math.sin(x*.018+phase)*(2.5+heat*4.5);
        if(x===-20)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  if(weather.storm>.12){
    const flashWave=Math.sin(state.time*1.73+terrainSeed*.00001);
    const flash=flashWave>.994 ? (flashWave-.994)/.006*weather.storm : 0;
    if(flash>0){ctx.fillStyle=`rgba(225,241,255,${Math.min(.24,flash*.24)})`;ctx.fillRect(0,0,width,height);}
  }
  ctx.restore();
}

function drawBiomeAtmosphere(){ /* wyłączone: bez sztucznych cząsteczek biomów */ }

function drawFarHills() { /* tło jest renderowane poza zoomem świata */ }
function terrainDetailHash(x, y, seed=0) {
  // Deterministyczny hash: szczegóły nie migoczą podczas ruchu kamery.
  let n=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed|0,1442695041))|0;
  n=(n^(n>>>13)); n=Math.imul(n,1274126177); n=(n^(n>>>16));
  return (n>>>0)/4294967295;
}
function drawProceduralSoilDetails(left,right,minY,bottom) {
  const cell=126;
  const worldLeft=Math.floor((left+state.cameraX)/cell)-1;
  const worldRight=Math.ceil((right+state.cameraX)/cell)+1;
  const worldTop=Math.floor((minY+state.cameraY)/cell)-1;
  const worldBottom=Math.ceil((bottom+state.cameraY)/cell)+1;

  // Drobne plamki i grudki ziemi — generowane w świecie, bez kafelków i bez łączeń.
  for(let gy=worldTop;gy<=worldBottom;gy++){
    for(let gx=worldLeft;gx<=worldRight;gx++){
      const r=terrainDetailHash(gx,gy,11);
      const wx=(gx+r*.78)*cell;
      const wy=(gy+terrainDetailHash(gx,gy,29)*.82)*cell;
      const x=wx-state.cameraX, y=wy-state.cameraY;
      const size=2.0+terrainDetailHash(gx,gy,43)*5.4;
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate(terrainDetailHash(gx,gy,57)*Math.PI);
      ctx.globalAlpha=.08+terrainDetailHash(gx,gy,71)*.11;
      ctx.fillStyle=terrainDetailHash(gx,gy,83)>.56?'#2c160d':'#bd7137';
      ctx.beginPath();ctx.ellipse(0,0,size,size*.45,0,0,Math.PI*2);ctx.fill();
      ctx.restore();

      // Rzadkie kamienie, każdy o innym położeniu i kształcie.
      if(terrainDetailHash(gx,gy,101)>.91){
        const sx=x+18*(terrainDetailHash(gx,gy,103)-.5);
        const sy=y+16*(terrainDetailHash(gx,gy,107)-.5);
        const sw=8+terrainDetailHash(gx,gy,109)*13;
        const sh=5+terrainDetailHash(gx,gy,113)*8;
        ctx.save();ctx.translate(sx,sy);ctx.rotate((terrainDetailHash(gx,gy,127)-.5)*1.1);
        ctx.fillStyle='rgba(55,43,34,.58)';ctx.beginPath();ctx.ellipse(0,0,sw,sh,0,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.10)';ctx.beginPath();ctx.ellipse(-sw*.2,-sh*.25,sw*.48,sh*.28,0,0,Math.PI*2);ctx.fill();
        ctx.restore();
      }
    }
  }

  // Subtelne korzenie tylko tuż pod powierzchnią, nigdy jako powtarzana tekstura.
  const rootStep=390;
  const rootStart=Math.floor((left+state.cameraX)/rootStep)-1;
  const rootEnd=Math.ceil((right+state.cameraX)/rootStep)+1;
  ctx.save();ctx.strokeStyle='rgba(75,38,15,.42)';ctx.lineCap='round';
  for(let i=rootStart;i<=rootEnd;i++){
    if(terrainDetailHash(i,0,151)<.72) continue;
    const wx=i*rootStep+terrainDetailHash(i,0,157)*rootStep*.7;
    const surface=terrainY(wx);
    const x=wx-state.cameraX, y=surface-state.cameraY+11;
    const len=28+terrainDetailHash(i,0,163)*42;
    ctx.lineWidth=1.4+terrainDetailHash(i,0,167)*1.7;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.bezierCurveTo(x-7,y+len*.28,x+9,y+len*.62,x+(terrainDetailHash(i,0,173)-.5)*28,y+len);ctx.stroke();
  }
  ctx.restore();
}
function drawTunnelCeiling() {
  const zoom=Math.max(.45,cameraZoom());
  const overscanX=Math.ceil((canvas.width/zoom-canvas.width)*.5)+180;
  const overscanY=Math.ceil((canvas.height/zoom-canvas.height)*.5)+180;
  const left=-overscanX,right=canvas.width+overscanX,top=-overscanY;
  const points=[];
  let visible=false;
  for(let sx=left;sx<=right+14;sx+=14){
    const wx=sx+state.cameraX, ceiling=tunnelCeilingY(wx);
    if(ceiling!==null){visible=true;points.push([sx,ceiling-state.cameraY,wx]);}
    else points.push([sx,top-900,wx]);
  }
  if(!visible)return;
  const distance=Math.max(0,state.car.x-250), bm=biomeMixAt(distance), climate=climateMixAt(distance);
  const soilTint=lerpColor(climate.a.soil,climate.b.soil,climate.t);
  const soilMix=mixNum(climate.a.soilMix,climate.b.soilMix,climate.t);
  const soil=bm.a.soil.map((c,i)=>lerpColor(lerpColor(c,bm.b.soil[i],bm.t),soilTint,soilMix));
  const maxY=Math.max(...points.map(p=>p[1]));
  ctx.save();
  ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(right,top);
  for(let i=points.length-1;i>=0;i--)ctx.lineTo(points[i][0],points[i][1]);
  ctx.closePath();ctx.clip();
  const fill=ctx.createLinearGradient(0,top,0,maxY+80);
  fill.addColorStop(0,soil[3]);fill.addColorStop(.62,soil[2]);fill.addColorStop(1,soil[1]);
  ctx.fillStyle=fill;ctx.fillRect(left,top,right-left,maxY-top+120);
  // Nieregularne smugi skalne pod sufitem.
  ctx.strokeStyle='rgba(255,210,150,.10)';ctx.lineWidth=9;ctx.lineCap='round';
  for(let layer=0;layer<3;layer++){
    ctx.beginPath();
    for(let x=left-30;x<=right+30;x+=42){
      const wx=x+state.cameraX;
      const cy=tunnelCeilingY(wx);
      const y=(cy===null?top-500:cy-state.cameraY)-65-layer*58+Math.sin(wx*.008+layer)*13;
      if(x===left-30)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=soil[0];ctx.lineWidth=17;ctx.stroke();
  ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y+3):ctx.moveTo(x,y+3));ctx.strokeStyle='rgba(30,18,15,.78)';ctx.lineWidth=7;ctx.stroke();
  ctx.restore();
}
function drawTerrain() {
  const zoom=Math.max(.45,cameraZoom()),overscanX=Math.ceil((canvas.width/zoom-canvas.width)*.5)+180,overscanY=Math.ceil((canvas.height/zoom-canvas.height)*.5)+180;
  const left=-overscanX,right=canvas.width+overscanX,bottom=canvas.height+overscanY,topPoints=[];
  for(let sx=left;sx<=right+14;sx+=14){const wx=sx+state.cameraX;topPoints.push([sx,terrainY(wx)-state.cameraY,wx]);}
  const minY=Math.min(...topPoints.map(p=>p[1]));
  const distance=Math.max(0,state.car.x-250), bm=biomeMixAt(distance), climate=climateMixAt(distance);
  const surfaceTint=lerpColor(climate.a.surface,climate.b.surface,climate.t);
  const soilTint=lerpColor(climate.a.soil,climate.b.soil,climate.t);
  const surfaceMix=mixNum(climate.a.surfaceMix,climate.b.surfaceMix,climate.t);
  const soilMix=mixNum(climate.a.soilMix,climate.b.soilMix,climate.t);
  let surface=bm.a.surface.map((c,i)=>lerpColor(lerpColor(c,bm.b.surface[i],bm.t),surfaceTint,surfaceMix));
  let soilCols=bm.a.soil.map((c,i)=>lerpColor(lerpColor(c,bm.b.soil[i],bm.t),soilTint,soilMix));
  const weather=weatherAt(distance);
  const wet=Math.max(weather.rain*.72,weather.storm*.82);
  if(wet>0){
    surface=surface.map(c=>lerpColor(c,'#2f704c',wet*.18));
    soilCols=soilCols.map(c=>lerpColor(c,'#251b1b',wet*.30));
  }
  if(weather.snow>0){surface=surface.map(c=>lerpColor(c,'#eef8ff',weather.snow*.42));}
  if(weather.heat>0){surface=surface.map(c=>lerpColor(c,'#d7c55a',weather.heat*.12));}
  ctx.save();ctx.beginPath();ctx.moveTo(left,bottom);for(const [x,y] of topPoints)ctx.lineTo(x,y);ctx.lineTo(right,bottom);ctx.closePath();ctx.clip();
  const soil=ctx.createLinearGradient(0,minY,0,bottom);soil.addColorStop(0,soilCols[0]);soil.addColorStop(.18,soilCols[1]);soil.addColorStop(.56,soilCols[2]);soil.addColorStop(1,soilCols[3]);ctx.fillStyle=soil;ctx.fillRect(left,minY-20,right-left,bottom-minY+40);
  const topSoil=ctx.createLinearGradient(0,minY-5,0,minY+120);topSoil.addColorStop(0,'rgba(255,225,164,.46)');topSoil.addColorStop(.5,'rgba(255,174,91,.16)');topSoil.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=topSoil;ctx.fillRect(left,minY-8,right-left,130);
  ctx.save();ctx.lineCap='round';for(let layer=0;layer<4;layer++){ctx.beginPath();for(let x=left-40;x<=right+40;x+=34){const wx=x+state.cameraX,surf=terrainY(wx)-state.cameraY,wob=Math.sin(wx*.0054+layer*1.8)*11+Math.sin(wx*.013+layer)*4,yy=surf+76+layer*94+wob;if(x===left-40)ctx.moveTo(x,yy);else ctx.lineTo(x,yy);}ctx.strokeStyle=layer%2?'rgba(255,190,105,.13)':'rgba(25,10,8,.16)';ctx.lineWidth=11+layer*3;ctx.stroke();}ctx.restore();
  drawProceduralSoilDetails(left,right,minY,bottom);ctx.restore();
  ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  ctx.beginPath();topPoints.forEach(([x,y],i)=>i?ctx.lineTo(x,y+4):ctx.moveTo(x,y+4));ctx.strokeStyle=surface[2];ctx.lineWidth=20;ctx.stroke();
  ctx.beginPath();topPoints.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=surface[1];ctx.lineWidth=12;ctx.stroke();
  ctx.beginPath();topPoints.forEach(([x,y],i)=>i?ctx.lineTo(x,y-5):ctx.moveTo(x,y-5));ctx.strokeStyle=surface[0];ctx.lineWidth=5;ctx.stroke();
  // Pogoda wpływa też wizualnie na samą nawierzchnię, bez nowych tekstur.
  if(wet>.03){
    ctx.globalAlpha=.10+wet*.18;ctx.strokeStyle='#d8f1ee';ctx.lineWidth=2.2;
    ctx.beginPath();topPoints.forEach(([x,y],i)=>i?ctx.lineTo(x,y-7):ctx.moveTo(x,y-7));ctx.stroke();
  }
  if(weather.snow>.03){
    ctx.globalAlpha=.24+weather.snow*.48;ctx.strokeStyle='#f7fcff';ctx.lineWidth=3+weather.snow*4;
    ctx.beginPath();topPoints.forEach(([x,y],i)=>i?ctx.lineTo(x,y-8):ctx.moveTo(x,y-8));ctx.stroke();
  }
  ctx.restore();
  // Brak proceduralnych drzewek, kaktusów i skał — czysta trasa.
}
function drawBiomeDecorations(left,right,bm){
  const idx=bm.index,step=idx===1||idx===3?520:760,start=Math.floor((left+state.cameraX)/step)-1,end=Math.ceil((right+state.cameraX)/step)+1;
  ctx.save();
  for(let i=start;i<=end;i++){
    if(terrainDetailHash(i,idx,201)<.48)continue;
    const wx=i*step+terrainDetailHash(i,idx,207)*step*.62,x=wx-state.cameraX,y=terrainY(wx)-state.cameraY;
    const r=terrainDetailHash(i,idx,211);
    if(idx===1||idx===3){const h=58+r*70;ctx.fillStyle=idx===3?'#dbeaf0':'#315b28';ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x-h*.32,y-h*.58);ctx.lineTo(x-h*.12,y-h*.55);ctx.lineTo(x-h*.4,y-h*.28);ctx.lineTo(x+h*.4,y-h*.28);ctx.lineTo(x+h*.12,y-h*.55);ctx.lineTo(x+h*.32,y-h*.58);ctx.closePath();ctx.fill();ctx.fillStyle=idx===3?'#52666b':'#493521';ctx.fillRect(x-4,y-h*.28,8,h*.28);}
    else if(idx===2){ctx.fillStyle='#676a66';ctx.beginPath();ctx.ellipse(x,y-7,18+r*18,10+r*10,-.2,0,Math.PI*2);ctx.fill();}
    else if(idx===4){ctx.strokeStyle='#6e8e34';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y-55-r*35);ctx.moveTo(x,y-35);ctx.lineTo(x-18,y-48);ctx.moveTo(x,y-48);ctx.lineTo(x+17,y-61);ctx.stroke();}
    else if(idx===5){ctx.fillStyle='rgba(255,78,34,.55)';ctx.beginPath();ctx.ellipse(x,y-4,15+r*22,4+r*3,0,0,Math.PI*2);ctx.fill();}
  }ctx.restore();
}

function drawObjects() {
  for (const o of state.objects) {
    if (!o.active) continue;
    const x=o.x-state.cameraX, bob=Math.sin(state.time*3+o.phase)*8, y=o.y-state.cameraY+bob;
    if (x < -150 || x > canvas.width+150) continue;
    ctx.save(); ctx.translate(x,y);
    ctx.rotate(Math.sin(state.time*2+o.phase)*.08);
    const img=images[o.type];
    if (ready(img)) {
      const crop=CROP[o.type]; if(crop) drawCropped(img,crop,0,0,o.size,o.size); else drawContain(img,0,0,o.size,o.size,.5,.5);
    } else {
      const colors={chip:'#ffd43b',fuel:'#e83b42',slot:'#9b55ff'};
      ctx.fillStyle=colors[o.type]; ctx.beginPath(); ctx.arc(0,0,o.size*.4,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}
function drawParticles() {
  for (const p of state.particles) {
    const x=p.x-state.cameraX, y=p.y-state.cameraY;
    ctx.save(); ctx.globalAlpha=Math.max(0,p.life/p.maxLife);
    const colors={dust:'#b79761',fire:'#ff9b2f',damageFire:'#ff7a1a',smoke:'#303741',coin:'#ffe05a',fuel:'#ff5b64',slot:'#c576ff',mud:'#6f4a2c',level:'#8ef7ff'};
    ctx.fillStyle=colors[p.kind]||'#fff';
    if(p.kind==='damageFire'){
      ctx.shadowColor='#ff8a20';ctx.shadowBlur=10;
      ctx.beginPath();ctx.moveTo(x,y-p.size*1.7);ctx.quadraticCurveTo(x+p.size,y-p.size*.2,x,y+p.size);ctx.quadraticCurveTo(x-p.size,y-p.size*.2,x,y-p.size*1.7);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle='#ffd75a';ctx.beginPath();ctx.ellipse(x,y,p.size*.35,p.size*.7,0,0,Math.PI*2);ctx.fill();
    }else{
      ctx.beginPath();ctx.arc(x,y,p.size,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
}
function drawCar() {
  const c=state.car;
  const x=c.x-state.cameraX,y=c.y-state.cameraY;
  // Mapa jest oddalona, ale samochód zachowuje czytelną wielkość.
  // Skala kompensuje część zoomu kamery bez zmiany fizyki i kolizji.
  const visualScale=1; // grafika 1:1 z geometrią kolizji
  if(ready(images.carShadow)){
    const gy=terrainY(c.x)-state.cameraY;
    const air=Math.max(0,Math.min(1,(gy-y)/220));
    ctx.save();ctx.globalAlpha=.34*(1-air*.65);
    drawCropped(images.carShadow,CROP.carShadow,x,gy-3,150*visualScale*(1-air*.25),12*visualScale*(1-air*.2));ctx.restore();
  }

  // Najpierw karoseria, potem koła — koła są na pierwszym planie.
  ctx.save();ctx.translate(x,y);ctx.rotate(c.angle);ctx.scale(visualScale,visualScale);
  const damaged=state.health<50;
  const body=damaged?images.carDamaged:images.car;
  if(ready(body)){
    const crop=damaged?CROP.carDamaged:CROP.car;
    const bodyW=CONFIG.car.bodyWidth;
    const bodyH=damaged ? CONFIG.car.bodyHeight*1.22 : CONFIG.car.bodyHeight;
    const offsetY=damaged ? CONFIG.car.bodyOffsetY-2 : CONFIG.car.bodyOffsetY;
    drawCropped(body,crop,0,offsetY,bodyW,bodyH);
  }else{ctx.fillStyle='#eee';ctx.fillRect(-118,-58,236,72);}
  if(state.health<45){
    const heat=(45-state.health)/45;
    ctx.globalAlpha=.18+.25*heat;ctx.fillStyle='#28313a';
    ctx.beginPath();ctx.arc(-38,-70,12+heat*6,0,Math.PI*2);ctx.arc(-25,-86,8+heat*5,0,Math.PI*2);ctx.fill();
    if(state.health<28){
      const flicker=.82+Math.sin(state.time*19)*.13+Math.sin(state.time*31)*.08;
      ctx.globalAlpha=.95;ctx.fillStyle='#ff7a16';ctx.shadowColor='#ff8a20';ctx.shadowBlur=11;
      ctx.beginPath();ctx.moveTo(-40,-60);ctx.quadraticCurveTo(-25,-78*flicker,-31,-98*flicker);ctx.quadraticCurveTo(-47,-82,-51,-62);ctx.closePath();ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle='#ffe36a';ctx.beginPath();ctx.ellipse(-40,-68,5,11*flicker,0,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();

  for(const w of c.wheels){
    const wx=w.x-state.cameraX,wy=w.y-state.cameraY;
    ctx.save();ctx.translate(wx,wy);ctx.rotate(w.spin);ctx.scale(visualScale,visualScale);
    if(ready(images.wheel))drawCropped(images.wheel,CROP.wheel,0,0,CONFIG.car.wheelSize,CONFIG.car.wheelSize);
    else{ctx.fillStyle='#111';ctx.beginPath();ctx.arc(0,0,CONFIG.car.wheelSize/2,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
}

let last=performance.now();
function loop(now) {
  const dt=Math.min(.033,(now-last)/1000); last=now;
  update(dt); audio.updateEngine(); draw(); requestAnimationFrame(loop);
}
resetGame(false); requestAnimationFrame(loop);
