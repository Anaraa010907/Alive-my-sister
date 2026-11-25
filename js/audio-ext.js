/* Хоёр ертөнц — chapter 2 «Чонын хөндий» sound effects and music layers.
 * Contract (docs/ARCHITECTURE.md, "Audio contract"):
 *   TW.sfxExt[name] = function(A, vol)
 *   TW.music[name]  = { start(A[, vol]), stop(A) }
 *   A = { AC, master, echoIn, noiseBuf, tone(...), noise(...) }
 * Everything is procedural. Peak gains are multiplied by vol and kept <= 0.25.
 * One-shot sounds are scheduled on AC.currentTime (no timers). Music layers use a
 * setInterval look-ahead scheduler that is cleared once the layer has faded out.
 */
(function(){
  'use strict';
  var TW = window.TW;
  if (!TW) return;
  var SFX = TW.sfxExt = TW.sfxExt || {};
  var MUS = TW.music = TW.music || {};

  var PEAK = 0.25;        // contract: no envelope peak above this
  var FADE = 1.0;         // music fade in/out, seconds
  var TICK_MS = 100;      // music scheduler interval
  var LOOKAHEAD = 1.0;    // seconds scheduled ahead (survives 1 s background-tab timer throttling)

  // ---------- small helpers ----------
  function rnd(a, b){ return a + Math.random() * (b - a); }
  function rint(a, b){ return Math.floor(rnd(a, b + 1 - 1e-9)); }
  function clampVol(v){ v = (typeof v === 'number' && isFinite(v)) ? v : 1; return v < 0 ? 0 : v > 1 ? 1 : v; }
  function cap(pk){ return pk > PEAK ? PEAK : pk < 1e-4 ? 1e-4 : pk; }
  function report(what, e){ try { console.error('[audio-ext] ' + what + ': ' + (e && e.message ? e.message : e)); } catch(_){} }
  function chain(){ for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]); return arguments[arguments.length - 1]; }

  // attack (exp) -> hold -> release (exp). Returns end time.
  function env(p, t, a, h, r, pk){
    pk = cap(pk);
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(pk, t + a);
    if (h > 0) p.setValueAtTime(pk, t + a + h);
    p.exponentialRampToValueAtTime(0.0001, t + a + h + r);
    return t + a + h + r;
  }
  // short burst on a gain that may carry several bursts (they must not overlap)
  function burst(p, t, a, r, pk){ return env(p, t, a, 0, r, pk); }

  var whiteCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var brownCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function whiteBuf(o){
    if (o.A.noiseBuf) return o.A.noiseBuf;
    var b = whiteCache && whiteCache.get(o.AC); if (b) return b;
    b = o.AC.createBuffer(1, o.AC.sampleRate, o.AC.sampleRate);
    var d = b.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (whiteCache) whiteCache.set(o.AC, b); return b;
  }
  // 4 s brown noise like the prototype wind, with a seamless loop point
  function brownBuf(AC){
    var b = brownCache && brownCache.get(AC); if (b) return b;
    var len = Math.floor(AC.sampleRate * 4), last = 0, i;
    b = AC.createBuffer(1, len, AC.sampleRate);
    var d = b.getChannelData(0);
    for (i = 0; i < len; i++){ last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    var drift = d[len - 1] - d[0];
    for (i = 0; i < len; i++) d[i] -= drift * i / (len - 1);
    if (brownCache) brownCache.set(AC, b); return b;
  }

  // A Voice owns every node of one sound; all sources start at t, stop at end,
  // and the whole graph is disconnected once the last source has ended.
  function Voice(o){ this.o = o; this.AC = o.AC; this.srcs = []; this.nodes = []; }
  Voice.prototype.keep = function(n){ this.nodes.push(n); return n; };
  Voice.prototype.osc = function(type, f){
    var n = this.AC.createOscillator(); n.type = type; n.frequency.value = f; this.srcs.push(n); return this.keep(n);
  };
  Voice.prototype.noise = function(buf){
    var n = this.AC.createBufferSource(); n.buffer = buf || whiteBuf(this.o); n.loop = true;
    n._twOff = Math.random() * n.buffer.duration * 0.9; this.srcs.push(n); return this.keep(n);
  };
  Voice.prototype.filter = function(type, f, q){
    var n = this.AC.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return this.keep(n);
  };
  Voice.prototype.gain = function(v){ var n = this.AC.createGain(); n.gain.value = v; return this.keep(n); };
  Voice.prototype.out = function(node, dry, wet){
    if (dry > 0){ var d = this.gain(dry); node.connect(d); d.connect(this.o.dest); }
    if (wet > 0 && this.o.edest){ var w = this.gain(wet); node.connect(w); w.connect(this.o.edest); }
  };
  Voice.prototype.play = function(t, end){
    var self = this, left = this.srcs.length;
    function done(){ if (--left <= 0) self.free(); }
    for (var i = 0; i < this.srcs.length; i++){
      var s = this.srcs[i];
      s.onended = done;
      if (s._twOff != null) s.start(t, s._twOff); else s.start(t);
      s.stop(end);
    }
  };
  Voice.prototype.free = function(){
    for (var i = 0; i < this.nodes.length; i++){ try { this.nodes[i].disconnect(); } catch(e){} }
    this.nodes = []; this.srcs = [];
  };

  // ---------- living world: wolves ----------
  // dist 0 = near, 1 = far away (darker, mostly echo)
  function howl(o, t, vol, dist){
    dist = dist || 0;
    var v = new Voice(o), k = rnd(0.9, 1.12), dur = rnd(2.3, 2.9);
    var fA = 330 * k, fB = 520 * k, fC = 548 * k, fD = 350 * k;
    var tB = t + rnd(0.45, 0.6), tC = t + dur * 0.62, tD = t + dur;
    var s = v.osc('sine', fA), w = v.osc('sawtooth', fA);
    w.detune.value = 6;
    [s.frequency, w.frequency].forEach(function(p){
      p.setValueAtTime(fA, t); p.exponentialRampToValueAtTime(fB, tB);
      p.linearRampToValueAtTime(fC, tC); p.exponentialRampToValueAtTime(fD, tD);
    });
    var lfo = v.osc('sine', rnd(4.6, 5.6)), lg = v.gain(0);           // vibrato grows over the howl
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(fB * 0.008, tB); lg.gain.linearRampToValueAtTime(fB * 0.022, tD);
    lfo.connect(lg); lg.connect(s.frequency); lg.connect(w.frequency);
    var wl = v.filter('lowpass', 1100, 0.7), wg = v.gain(0.38);
    chain(w, wl, wg);
    var eg = v.gain(0); s.connect(eg); wg.connect(eg);
    env(eg.gain, t, 0.42, Math.max(0.1, tC - t - 0.42), tD - tC, 0.09 * vol);
    var lp = v.filter('lowpass', 4200 - 3400 * dist, 0.5);
    eg.connect(lp);
    v.out(lp, 1 - 0.6 * dist, 0.35 + 0.4 * dist);
    v.play(t, tD + 0.05);
  }

  function growl(o, t, vol){
    var v = new Voice(o), dur = rnd(0.85, 1.25);
    var n = v.noise(), bp = v.filter('bandpass', rnd(150, 200), 1.0), nl = v.filter('lowpass', 600, 0.7), ng = v.gain(2.2);
    chain(n, bp, nl, ng);
    var th = v.osc('sawtooth', 80), tl = v.filter('lowpass', 340, 3), tg = v.gain(0.3);  // throat tone
    th.frequency.setValueAtTime(rnd(74, 84), t); th.frequency.linearRampToValueAtTime(rnd(56, 64), t + dur);
    chain(th, tl, tg);
    var am = v.gain(0.5), lfo = v.osc('sine', rnd(23, 27)), ld = v.gain(0.5);            // ~25 Hz rattle
    lfo.frequency.setValueAtTime(lfo.frequency.value, t); lfo.frequency.linearRampToValueAtTime(rnd(20, 24), t + dur);
    lfo.connect(ld); ld.connect(am.gain);
    ng.connect(am); tg.connect(am);
    var eg = v.gain(0); am.connect(eg);
    env(eg.gain, t, 0.12, dur - 0.42, 0.3, 0.22 * vol);
    v.out(eg, 1, 0.08);
    v.play(t, t + dur + 0.05);
  }

  function wolfStep(o, t, vol){
    var v = new Voice(o);
    var n = v.noise(), lp = v.filter('lowpass', rnd(260, 420), 0.8), mk = v.gain(1.6), g = v.gain(0);
    chain(n, lp, mk, g); burst(g.gain, t, 0.004, rnd(0.05, 0.08), 0.25 * vol);
    var c = v.noise(), hp = v.filter('highpass', rnd(3000, 4200), 0.7), cg = v.gain(0);   // claw tick
    chain(c, hp, cg); burst(cg.gain, t + 0.003, 0.001, 0.018, 0.03 * vol);
    v.out(g, 1, 0); v.out(cg, 1, 0);
    v.play(t, t + 0.12);
  }

  function bark(o, t, vol){
    var v = new Voice(o), dur = rnd(0.16, 0.22), f = rnd(300, 360);
    var s = v.osc('sawtooth', f), q = v.osc('square', f * 0.5);
    [[s, 1], [q, 0.5]].forEach(function(x){
      var p = x[0].frequency, m = x[1];
      p.setValueAtTime(f * m * 0.85, t); p.exponentialRampToValueAtTime(f * m, t + 0.025); p.exponentialRampToValueAtTime(f * m * 0.55, t + dur);
    });
    var qg = v.gain(0.3); q.connect(qg);
    var bp = v.filter('bandpass', rnd(650, 800), 1.2), lp = v.filter('lowpass', 2200, 0.7);
    s.connect(bp); qg.connect(bp); bp.connect(lp);
    var n = v.noise(), nb = v.filter('bandpass', 1000, 0.8), ng = v.gain(0.5);
    chain(n, nb, ng, lp);
    var eg = v.gain(0); lp.connect(eg);
    env(eg.gain, t, 0.008, dur * 0.25, dur * 0.75, 0.2 * vol);
    v.out(eg, 1, 0.25);
    v.play(t, t + dur + 0.08);
  }

  // ---------- living world: raven ----------
  function cawBurst(o, t, vol, pm){
    var v = new Voice(o), dur = rnd(0.15, 0.2), f0 = rnd(540, 620) * pm, f1 = f0 * rnd(0.62, 0.72);
    var a = v.osc('sawtooth', f0), b = v.osc('square', f0);
    b.detune.value = rnd(18, 30);
    [a, b].forEach(function(x){
      var p = x.frequency;
      p.setValueAtTime(f0 * 0.95, t); p.exponentialRampToValueAtTime(f0 * 1.04, t + 0.03); p.exponentialRampToValueAtTime(f1, t + dur);
    });
    var bg = v.gain(0.5); b.connect(bg);
    var rough = v.gain(0.6), lfo = v.osc('square', rnd(55, 75)), ld = v.gain(0.4);       // rasp
    lfo.connect(ld); ld.connect(rough.gain);
    a.connect(rough); bg.connect(rough);
    var hp = v.filter('highpass', 500, 0.7), bp = v.filter('bandpass', rnd(1250, 1500), 2.2), eg = v.gain(0);
    chain(rough, hp, bp, eg);
    env(eg.gain, t, 0.012, dur * 0.35, dur * 0.65, 0.25 * vol);
    v.out(eg, 1, 0.3);
    v.play(t, t + dur + 0.05);
  }
  function caw(o, t, vol){
    var n = Math.random() < 0.5 ? 2 : 3, gap = rnd(0.25, 0.31);
    for (var i = 0; i < n; i++) cawBurst(o, t + i * gap + (i ? rnd(-0.02, 0.02) : 0), vol * (i === n - 1 ? 0.85 : 1), 1 - i * 0.035);
  }

  function flap(o, t, vol){
    var v = new Voice(o), n = rint(3, 4), sp = rnd(0.11, 0.14);
    var src = v.noise(), bp = v.filter('bandpass', 600, 0.9), g = v.gain(0);
    var src2 = v.noise(), lp = v.filter('lowpass', 220, 0.7), g2 = v.gain(0);
    chain(src, bp, g); chain(src2, lp, g2);
    for (var i = 0; i < n; i++){
      var tb = t + i * sp, k = 1 - i * 0.14;
      bp.frequency.setValueAtTime(rnd(480, 760), tb);
      burst(g.gain, tb, 0.03, 0.07, 0.2 * k * vol);
      burst(g2.gain, tb + 0.02, 0.006, 0.06, 0.2 * k * vol);
    }
    v.out(g, 1, 0.1); v.out(g2, 1, 0);
    v.play(t, t + n * sp + 0.1);
  }

  // ---------- dead world: shulam ----------
  function breath(o, t, vol){
    var v = new Voice(o), k = rnd(0.85, 1.15);
    var tI = t + 0.95 * k, tE = tI + 0.14, eA = 1.35 * k, tEnd = tE + eA;
    var n = v.noise(), bp = v.filter('bandpass', 420, 2.0), mk = v.gain(2.0), g = v.gain(0);
    bp.frequency.setValueAtTime(420, t); bp.frequency.exponentialRampToValueAtTime(1150, tI);
    bp.frequency.setValueAtTime(950, tE); bp.frequency.exponentialRampToValueAtTime(330, tEnd);
    chain(n, bp, mk, g);
    var pi = cap(0.12 * vol), pe = cap(0.2 * vol);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pi, t + (tI - t) * 0.6); g.gain.linearRampToValueAtTime(0.0001, tI); // inhale
    g.gain.setValueAtTime(0.0001, tE); g.gain.exponentialRampToValueAtTime(pe, tE + 0.18);                                          // exhale
    g.gain.setValueAtTime(pe, tE + eA * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    // wet gurgle on the exhale: low resonant noise, irregular amplitude flutter
    var n2 = v.noise(), lp = v.filter('lowpass', 280, 4), mk2 = v.gain(2.5), am = v.gain(0.5), g2 = v.gain(0);
    var lfo = v.osc('sine', 10), ld = v.gain(0.5);
    for (var tt = t; tt < tEnd; tt += 0.15) lfo.frequency.setValueAtTime(rnd(6, 14), tt);
    lfo.connect(ld); ld.connect(am.gain);
    chain(n2, lp, mk2, am, g2);
    env(g2.gain, tE, 0.22, eA * 0.3, eA * 0.55, 0.16 * vol);
    v.out(g, 1, 0.3); v.out(g2, 1, 0.25);
    v.play(t, tEnd + 0.05);
  }

  function shriek(o, t, vol){
    var v = new Voice(o), dur = rnd(0.5, 0.65), f = rnd(1150, 1300);
    var mix = v.gain(0.34), lfo = v.osc('sine', rnd(11, 15)), ld = v.gain(40);
    lfo.connect(ld);
    [1, 1.031, 0.958].forEach(function(r){
      var s = v.osc('sawtooth', f * r), p = s.frequency;
      p.setValueAtTime(f * r * 0.85, t); p.exponentialRampToValueAtTime(f * r * 1.22, t + 0.07); p.exponentialRampToValueAtTime(f * r * 0.6, t + dur);
      ld.connect(p); s.connect(mix);
    });
    var hp = v.filter('highpass', 700, 0.7), bp = v.filter('bandpass', 2100, 1.3), eg = v.gain(0);
    chain(mix, hp, bp, eg);
    env(eg.gain, t, 0.015, 0.06, dur - 0.075, 0.2 * vol);
    var n = v.noise(), nh = v.filter('highpass', 3800, 0.7), ng = v.gain(0);
    chain(n, nh, ng);
    env(ng.gain, t, 0.01, 0.04, dur * 0.6, 0.06 * vol);
    v.out(eg, 1, 0.5); v.out(ng, 1, 0.3);
    v.play(t, t + dur + 0.05);
  }

  function crawl(o, t, vol){
    var v = new Voice(o), n = rint(6, 9), tt = t;
    var src = v.noise(), bp = v.filter('bandpass', 3000, 5), mk = v.gain(2), g = v.gain(0);
    chain(src, bp, mk, g);
    for (var i = 0; i < n; i++){
      bp.frequency.setValueAtTime(rnd(2200, 5200), tt);
      burst(g.gain, tt, 0.0015, rnd(0.01, 0.02), rnd(0.12, 0.22) * vol);
      tt += rnd(0.04, 0.1);
    }
    var d = v.noise(), dl = v.filter('lowpass', 320, 0.7), dg = v.gain(0);                // body dragging
    chain(d, dl, dg);
    var dEnd = env(dg.gain, t, 0.07, Math.max(0.05, tt - t - 0.25), 0.18, 0.08 * vol);
    v.out(g, 1, 0.12); v.out(dg, 1, 0);
    v.play(t, Math.max(tt, dEnd) + 0.05);
  }

  // ---------- dead world: floor ----------
  function ping(o, t, f, d, pk){   // short inharmonic bone/wood resonance
    var v = new Voice(o), a = v.osc('sine', f), b = v.osc('sine', f * 2.76), bg = v.gain(0.35), g = v.gain(0);
    a.frequency.setValueAtTime(f, t); a.frequency.exponentialRampToValueAtTime(f * 0.92, t + d);
    b.connect(bg); a.connect(g); bg.connect(g);
    burst(g.gain, t, 0.001, d, pk);
    v.out(g, 1, 0.06);
    v.play(t, t + d + 0.03);
  }
  function bones(o, t, vol){
    var v = new Voice(o), n = rint(3, 5), tt = t, end = t;
    var src = v.noise(), hp = v.filter('highpass', 1800, 0.7), g = v.gain(0);
    var low = v.noise(), lp = v.filter('lowpass', 700, 0.7), lg = v.gain(0);
    chain(src, hp, g); chain(low, lp, lg);
    burst(lg.gain, t, 0.002, 0.05, 0.11 * vol);
    for (var i = 0; i < n; i++){
      burst(g.gain, tt, 0.0015, rnd(0.015, 0.03), rnd(0.08, 0.15) * vol);
      ping(o, tt + 0.001, rnd(900, 2300), rnd(0.035, 0.07), rnd(0.05, 0.09) * vol);
      end = tt + 0.1;
      tt += rnd(0.045, 0.09);
    }
    v.out(g, 1, 0.08); v.out(lg, 1, 0);
    v.play(t, end + 0.05);
  }

  // ---------- living world: hiding ----------
  function grass(o, t, vol){
    var v = new Voice(o), dur = rnd(0.45, 0.7), t2 = t + dur * 0.42;
    var n = v.noise(), hp = v.filter('highpass', 1600, 0.7), bp = v.filter('bandpass', 2600, 0.8), mk = v.gain(1.5), am = v.gain(0.7), g = v.gain(0);
    bp.frequency.setValueAtTime(rnd(2200, 2800), t); bp.frequency.linearRampToValueAtTime(rnd(3800, 4800), t + dur * 0.4);
    bp.frequency.linearRampToValueAtTime(rnd(2600, 3200), t + dur);
    var lfo = v.osc('sine', rnd(13, 19)), ld = v.gain(0.3);                                // blades flicking
    lfo.connect(ld); ld.connect(am.gain);
    chain(n, hp, bp, mk, am, g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(cap(0.13 * vol), t + 0.12);
    g.gain.linearRampToValueAtTime(cap(0.05 * vol), t2); g.gain.linearRampToValueAtTime(cap(0.09 * vol), t2 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    v.out(g, 1, 0);
    v.play(t, t + dur + 0.05);
  }

  // ---------- tension ----------
  function thump(o, t, f0, f1, pk){
    var v = new Voice(o), s = v.osc('sine', f0), g = v.gain(0);
    s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(f1, t + 0.12);
    s.connect(g); burst(g.gain, t, 0.006, 0.17, pk);
    var n = v.noise(), lp = v.filter('lowpass', 140, 0.7), ng = v.gain(0);
    chain(n, lp, ng); burst(ng.gain, t, 0.004, 0.06, pk * 0.6);
    v.out(g, 1, 0); v.out(ng, 1, 0);
    v.play(t, t + 0.22);
  }
  function heartbeat(o, t, vol){
    thump(o, t, 66, 42, 0.22 * vol);
    thump(o, t + rnd(0.22, 0.26), 58, 38, 0.15 * vol);
  }

  // ---------- registration of one-shots ----------
  function reg(name, fn){
    SFX[name] = function(A, vol){
      if (!A || !A.AC || !A.master) return;
      vol = clampVol(vol);
      if (vol <= 0.0005) return;
      try { fn({ A: A, AC: A.AC, dest: A.master, edest: A.echoIn }, A.AC.currentTime + 0.005, vol); }
      catch (e) { report(name, e); }
    };
  }
  reg('wolfHowl', function(o, t, vol){ howl(o, t, vol, 0); });
  reg('wolfGrowl', growl);
  reg('wolfStep', wolfStep);
  reg('wolfBark', bark);
  reg('ravenCaw', caw);
  reg('ravenFlap', flap);
  reg('shulamBreath', breath);
  reg('shulamShriek', shriek);
  reg('shulamCrawl', crawl);
  reg('bones', bones);
  reg('grassRustle', grass);
  reg('heartbeat', heartbeat);

  // ---------- music layers ----------
  // Each start() makes (or revives) one instance: a fader bus to A.master plus a fader
  // send to A.echoIn, persistent sources, and a look-ahead scheduler. stop() fades both
  // faders to 0 over FADE; the scheduler tears everything down after the fade. A start()
  // during a fade-out revives the same instance, so per-frame on/off toggling never
  // stacks instances.
  function persist(c, n, isSrc){ c.nodes.push(n); if (isSrc) c.srcs.push(n); return n; }
  function pOsc(c, type, f){ var n = c.AC.createOscillator(); n.type = type; n.frequency.value = f; return persist(c, n, true); }
  function pGain(c, v){ var n = c.AC.createGain(); n.gain.value = v; return persist(c, n); }
  function pFilter(c, type, f, q){ var n = c.AC.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return persist(c, n); }
  function pNoise(c, buf){ var n = c.AC.createBufferSource(); n.buffer = buf; n.loop = true; n._twOff = Math.random() * buf.duration * 0.9; return persist(c, n, true); }
  function pLfo(c, f, depth, param){ var l = pOsc(c, 'sine', f), g = pGain(c, depth); l.connect(g); g.connect(param); return l; }
  function startAll(c, t){ c.srcs.forEach(function(s){ if (s._twOff != null) s.start(t, s._twOff); else s.start(t); }); }

  function fade(c, target){
    var t = c.AC.currentTime, ref = Math.max(c.level, 1e-3), cur = c.bus.gain.value;
    var span = Math.max(0.05, FADE * Math.min(1, Math.abs(target - cur) / ref));
    [c.bus.gain, c.ebus.gain].forEach(function(p){
      var v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); p.linearRampToValueAtTime(target, t + span);
    });
    return t + span;
  }
  function teardown(c){
    if (c.dead) return;
    c.dead = true;
    if (c.timer){ clearInterval(c.timer); c.timer = null; }
    c.srcs.forEach(function(s){ try { s.stop(); } catch(e){} });
    c.nodes.concat([c.bus, c.ebus]).forEach(function(n){ try { n.disconnect(); } catch(e){} });
    c.srcs = []; c.nodes = [];
    if (c.L.cur === c) c.L.cur = null;
  }
  function tick(c){
    if (c.dead) return;
    try {
      if (c.AC.state === 'closed'){ teardown(c); return; }
      var now = c.AC.currentTime;
      if (c.fading && now >= c.fadeEnd + 0.05){ teardown(c); return; }
      var until = now + LOOKAHEAD;
      if (c.fading) until = Math.min(until, c.fadeEnd);
      if (c.def.schedule) c.def.schedule(c, now, until);
    } catch (e){ report('music tick', e); teardown(c); }
  }
  function startLayer(L, def, A, vol){
    if (!A || !A.AC || !A.master) return;
    var AC = A.AC;
    if (AC.state === 'closed') return;
    var level = clampVol(vol), c = L.cur;
    if (c && (c.dead || c.AC !== AC)){ teardown(c); c = L.cur = null; }
    if (c){
      if (c.fading || Math.abs(c.level - level) > 1e-3){ c.fading = false; c.level = level; fade(c, level); }
      return;
    }
    c = L.cur = { L: L, def: def, A: A, AC: AC, level: level, srcs: [], nodes: [], fading: false, dead: false, timer: null, fadeEnd: 0, st: {} };
    try {
      c.bus = AC.createGain(); c.bus.gain.value = 0; c.bus.connect(A.master);
      c.ebus = AC.createGain(); c.ebus.gain.value = 0; if (A.echoIn) c.ebus.connect(A.echoIn);
      c.o = { A: A, AC: AC, dest: c.bus, edest: c.ebus };
      def.build(c, AC.currentTime);
      fade(c, level);
      tick(c);
      if (!c.dead) c.timer = setInterval(function(){ tick(c); }, TICK_MS);
    } catch (e){ teardown(c); throw e; }
  }
  function stopLayer(L){
    var c = L.cur;
    if (!c || c.dead || c.fading) return;
    c.fading = true;
    c.fadeEnd = fade(c, 0);
  }
  function layer(name, def){
    var L = { cur: null };
    MUS[name] = {
      start: function(A, vol){ try { startLayer(L, def, A, vol); } catch (e){ report('music.' + name + '.start', e); } },
      stop: function(A){ try { stopLayer(L); } catch (e){ report('music.' + name + '.stop', e); } }
    };
  }

  // chase: low pulse at 128 bpm + dissonant drone (55 Hz against 58.3 Hz, tritone above)
  var STEP = 60 / 128 / 4;
  var KICK = { 0: 1, 4: 0.55, 8: 0.85, 12: 0.55, 14: 0.3, 15: 0.45 };
  function kick(o, t, acc){
    var v = new Voice(o), s = v.osc('sine', 100), g = v.gain(0);
    s.frequency.setValueAtTime(100, t); s.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    s.connect(g); burst(g.gain, t, 0.003, 0.22, 0.15 * acc);
    var n = v.noise(), lp = v.filter('lowpass', 900, 0.7), ng = v.gain(0);
    chain(n, lp, ng); burst(ng.gain, t, 0.002, 0.025, 0.05 * acc);
    v.out(g, 1, 0.06); v.out(ng, 1, 0);
    v.play(t, t + 0.26);
  }
  function hat(o, t, acc){
    var v = new Voice(o), n = v.noise(), hp = v.filter('highpass', 6000, 0.7), g = v.gain(0);
    chain(n, hp, g); burst(g.gain, t, 0.001, 0.03, 0.035 * acc);
    v.out(g, 1, 0.15);
    v.play(t, t + 0.05);
  }
  function boom(o, t){
    var v = new Voice(o), s = v.osc('sine', 48), g = v.gain(0);
    s.frequency.setValueAtTime(48, t); s.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    s.connect(g); env(g.gain, t, 0.01, 0.1, 0.8, 0.08);
    v.out(g, 1, 0.1);
    v.play(t, t + 0.95);
  }
  layer('chase', {
    build: function(c, t){
      var s1 = pOsc(c, 'sawtooth', 55), s2 = pOsc(c, 'sawtooth', 58.27), s3 = pOsc(c, 'sine', 77.78);
      var lp = pFilter(c, 'lowpass', 240, 6), dg = pGain(c, 0.06), sg = pGain(c, 0.035);
      pLfo(c, 0.11, 80, lp.frequency);          // slow growl in the drone colour
      pLfo(c, 0.07, 8, s2.detune);              // unsettling drift of the minor second
      s1.connect(lp); s2.connect(lp); chain(lp, dg, c.bus);
      chain(s3, sg, c.bus);
      startAll(c, t);
      c.st = { next: t + 0.05, i: 0 };
    },
    schedule: function(c, now, until){
      var st = c.st;
      if (st.next < now - 0.005){ var k = Math.ceil((now - st.next) / STEP); st.next += k * STEP; st.i += k; }
      while (st.next < until){
        var s = st.i % 16, bar = Math.floor(st.i / 16);
        if (KICK[s]) kick(c.o, st.next, KICK[s]);
        if (s % 2 === 0) hat(c.o, st.next, s % 4 === 2 ? 0.8 : 0.4);
        if (s === 0 && bar % 4 === 0) boom(c.o, st.next);
        st.next += STEP; st.i++;
      }
    }
  });

  // valley: very quiet night bed — low wind, a moaning wind tone, far-off howls
  layer('valley', {
    build: function(c, t){
      var w = pNoise(c, brownBuf(c.AC)), lp = pFilter(c, 'lowpass', 420, 0.6), wg = pGain(c, 0.04);
      pLfo(c, 0.06, 170, lp.frequency);
      chain(w, lp, wg, c.bus);
      var n = pNoise(c, c.A.noiseBuf || brownBuf(c.AC)), bp = pFilter(c, 'bandpass', 280, 9), tg = pGain(c, 0.22);
      pLfo(c, 0.043, 90, bp.frequency);
      pLfo(c, 0.11, 25, bp.frequency);
      pLfo(c, 0.05, 0.15, tg.gain);              // slow swells: the wind moans now and then
      var te = pGain(c, 0.3);
      chain(n, bp, tg, c.bus); tg.connect(te); te.connect(c.ebus);
      startAll(c, t);
      c.st = { nextHowl: t + rnd(3, 6) };
    },
    schedule: function(c, now, until){
      var st = c.st;
      if (st.nextHowl < now) st.nextHowl = now + rnd(0.5, 3);
      while (st.nextHowl < until){
        var T = st.nextHowl;
        howl(c.o, T, 0.6, 1);
        if (Math.random() < 0.35) howl(c.o, T + rnd(1.0, 2.2), 0.42, 1);   // another wolf answers
        st.nextHowl = T + rnd(11, 24);
      }
    }
  });
})();
