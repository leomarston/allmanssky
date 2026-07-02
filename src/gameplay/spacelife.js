// Ambient space life: NPC traders flying station lanes with comm barks,
// salvageable derelicts, and anomaly set-pieces (black hole accretion disc,
// wormhole). Everything deterministic per system seed.
//
// CONTRACT: new SpaceLife(scene, system, gameState, spaceState)
//   .update(dt, playerShipPos)   .dispose()
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { events } from '../core/events.js';
import { input } from '../core/input.js';
import { buildShip } from '../render/shipmesh.js';
import { greeting, shipName, FACTIONS } from '../universe/lore.js';
import { audio } from '../audio/audio.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class SpaceLife {
  constructor(scene, system, gs, space) {
    this.scene = scene;
    this.system = system;
    this.gs = gs;
    this.space = space;
    this.rng = new RNG(hash32(system.seed ?? 1, 0x11fe));
    this.traffic = [];
    this._anomalyMeshes = [];
    this._t = 0;

    if (system.station) this._spawnTraffic();
    if (system.anomaly) this._buildAnomaly();
  }

  _spawnTraffic() {
    const n = this.rng.int(1, 3);
    const faction = this.system.station.faction ?? 'meridian';
    for (let i = 0; i < n; i++) {
      const cls = this.rng.pick(['dray', 'dray', 'swift']);
      const built = buildShip(hash32(this.system.seed, 500 + i), cls);
      const scale = cls === 'dray' ? 1.4 : 1;
      built.group.scale.setScalar(scale);
      // lane: station <-> a planet, offset so ships don't overlap
      const st = this.space.station?.group.position ?? new THREE.Vector3(560, 40, 0);
      const target = this.space.planets.length
        ? this.space.planets[this.rng.int(0, this.space.planets.length - 1)].visual.group.position
        : new THREE.Vector3(-800, 0, 400);
      const a = { from: st.clone(), to: target.clone().add(_v1.set(0, 120 + i * 40, 0)) };
      const t0 = this.rng.next();
      built.group.position.lerpVectors(a.from, a.to, t0);
      this.scene.add(built.group);
      const trail = this.space.effects.engineTrail?.(built.group, '#8fd0ff');
      trail?.setLevel?.(0.4);
      this.traffic.push({
        built, trail, lane: a, t: t0, dir: 1,
        speed: this.rng.range(0.008, 0.016),  // lane fraction/s
        name: shipName(this.rng.fork(`sn${i}`)),
        faction,
        barked: false,
      });
    }
  }

  _buildAnomaly() {
    const { kind, orbitRadius = 1400, angle = 2.2 } = this.system.anomaly;
    const pos = new THREE.Vector3(Math.cos(angle) * orbitRadius, -30, Math.sin(angle) * orbitRadius);
    this.anomalyPos = pos;
    this.anomalyKind = kind;
    this._salvaged = !!this.gs.discoveries.ruins[`anomaly:${this.system.id}`];

    if (kind === 'derelict') {
      const built = buildShip(hash32(this.system.seed, 666), 'dray');
      built.group.scale.setScalar(2.2);
      built.group.rotation.set(0.6, 1.9, 2.6);
      built.group.position.copy(pos);
      // dead ship: kill emissives, darken hull
      built.group.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          if (o.material.emissive) o.material.emissive.multiplyScalar(0.06);
          if (o.material.color) o.material.color.multiplyScalar(0.4);
        }
      });
      this.scene.add(built.group);
      this._anomalyMeshes.push(built.group);
      this._derelictFlicker = built.engineGlows?.[0] ?? null;
    } else if (kind === 'blackhole') {
      const hole = new THREE.Mesh(
        new THREE.SphereGeometry(26, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      hole.position.copy(pos);
      // accretion disc: additive gradient ring, HDR inner edge
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 32;
      const g2 = cv.getContext('2d');
      const grad = g2.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.12, 'rgba(255,244,214,0.95)');
      grad.addColorStop(0.35, 'rgba(255,170,80,0.8)');
      grad.addColorStop(0.75, 'rgba(180,80,40,0.35)');
      grad.addColorStop(1, 'rgba(120,40,30,0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 256, 32);
      const discTex = new THREE.CanvasTexture(cv);
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(30, 95, 96, 1),
        new THREE.MeshBasicMaterial({
          map: discTex, color: new THREE.Color(2.6, 1.9, 1.2),
          transparent: true, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      // map ring UVs radially so the gradient runs inner→outer
      const uv = disc.geometry.attributes.uv, p = disc.geometry.attributes.position;
      for (let i = 0; i < uv.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (r - 30) / 65, 0.5);
      }
      disc.rotation.x = Math.PI / 2 - 0.28;
      disc.position.copy(pos);
      // photon rim: thin bright fresnel shell
      const rim = new THREE.Mesh(
        new THREE.SphereGeometry(27.2, 48, 48),
        new THREE.ShaderMaterial({
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
          uniforms: { uCol: { value: new THREE.Color(3.5, 2.6, 1.6) } },
          vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }',
          fragmentShader: 'uniform vec3 uCol; varying vec3 vN; varying vec3 vW; void main(){ float f = pow(1.0 - abs(dot(normalize(cameraPosition - vW), normalize(vN))), 6.0); gl_FragColor = vec4(uCol, f); }',
        })
      );
      rim.position.copy(pos);
      this.scene.add(hole, disc, rim);
      this._anomalyMeshes.push(hole, disc, rim);
      this._disc = disc;
      this._discTex = discTex;
    } else if (kind === 'wormhole') {
      const cv = document.createElement('canvas');
      cv.width = 128; cv.height = 128;
      const g2 = cv.getContext('2d');
      const grad = g2.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, 'rgba(240,255,255,1)');
      grad.addColorStop(0.3, 'rgba(140,120,255,0.8)');
      grad.addColorStop(0.7, 'rgba(60,40,160,0.3)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(cv);
      const portal = new THREE.Mesh(
        new THREE.CircleGeometry(22, 48),
        new THREE.MeshBasicMaterial({
          map: tex, color: new THREE.Color(1.8, 1.6, 3.2), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        })
      );
      portal.position.copy(pos);
      this.scene.add(portal);
      this._anomalyMeshes.push(portal);
      this._portal = portal;
      this._portalTex = tex;
    }
  }

  update(dt, playerPos) {
    this._t += dt;

    // traffic lanes
    for (const tr of this.traffic) {
      tr.t += tr.speed * tr.dir * dt;
      if (tr.t > 1 || tr.t < 0) {
        tr.dir *= -1;
        tr.t = THREE.MathUtils.clamp(tr.t, 0, 1);
      }
      const g = tr.built.group;
      _v1.lerpVectors(tr.lane.from, tr.lane.to, tr.t);
      _v2.copy(_v1).sub(g.position);
      if (_v2.lengthSq() > 0.01) {
        _q1.setFromUnitVectors(_v1.set(0, 0, -1), _v2.normalize());
        g.quaternion.slerp(_q1, Math.min(1, dt * 2));
      }
      g.position.lerpVectors(tr.lane.from, tr.lane.to, tr.t);

      // one-time comm bark when the player draws near
      if (!tr.barked && playerPos.distanceTo(g.position) < 90) {
        tr.barked = true;
        const f = FACTIONS[tr.faction] ? tr.faction : 'meridian';
        events.emit('notify', {
          text: `[${tr.name}] — ${greeting(this.rng.fork('bark' + tr.name), f)}`,
          tone: 'info',
        });
        audio.sfx('notify');
      }
    }

    // anomaly behaviors
    if (this.anomalyPos) {
      const d = playerPos.distanceTo(this.anomalyPos);
      if (this._disc) {
        this._disc.rotation.z += dt * 0.05;
        if (d < 220 && !this._surveyed) {
          this._surveyed = true;
          if (this.gs.discover('ruins', `anomaly:${this.system.id}`, 'Gravimetric Survey', 500)) {
            events.emit('notify', { text: 'GRAVIMETRIC SURVEY LOGGED — +500 ⌾', tone: 'good' });
          }
        }
      }
      if (this._portal) {
        this._portal.lookAt(playerPos);
        this._portal.scale.setScalar(1 + Math.sin(this._t * 1.7) * 0.06);
        if (d < 30 && !this._peeked) {
          this._peeked = true;
          events.emit('notify', { text: 'WORMHOLE UNSTABLE — the far mouth is dark. Not yet.', tone: 'warn' });
        }
      }
      if (this.anomalyKind === 'derelict') {
        if (this._derelictFlicker) {
          const on = Math.sin(this._t * 7.3) > 0.86;
          this._derelictFlicker.visible = on;
        }
        if (d < 40 && !this._salvaged) {
          this.space._interactLabel = 'F — SALVAGE DERELICT';
          if (input.actionPressed('interact')) {
            this._salvaged = true;
            const rng = this.rng.fork('salvage');
            const lum = rng.int(300, 600);
            this.gs.addItem('nebulite', 2);
            this.gs.addLumens(lum);
            if (rng.chance(0.2)) {
              this.gs.addItem('luminelshard', 1);
              events.emit('notify', { text: 'Among the wreck: a Luminel Shard.', tone: 'info' });
            }
            this.gs.discover('ruins', `anomaly:${this.system.id}`, 'Derelict Salvage', 200);
            events.emit('notify', { text: `DERELICT STRIPPED — +2 Nebulite, +${lum} ⌾`, tone: 'good' });
            audio.sfx('scanDone');
          }
        }
      }
    }
  }

  dispose() {
    for (const tr of this.traffic) {
      tr.trail?.dispose?.();
      this.scene.remove(tr.built.group);
    }
    this.traffic.length = 0;
    for (const m of this._anomalyMeshes) this.scene.remove(m);
    this._anomalyMeshes.length = 0;
    this._discTex?.dispose();
    this._portalTex?.dispose();
  }
}
