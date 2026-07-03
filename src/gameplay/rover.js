// Exocraft controller: summon, board, and drive the all-terrain rover. Arcade
// handling — velocity follows the heading, four wheels suspend to the terrain
// and the hull banks to the average slope. Water and cliffs stop you.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { buildRover } from '../render/exocraft.js';
import { audio } from '../audio/audio.js';

const TOP_SPEED = 24;       // m/s
const ACCEL = 14;
const BRAKE = 26;
const STEER = 1.7;          // rad/s at low speed
const MAX_CLIMB = Math.cos(THREE.MathUtils.degToRad(42)); // steeper than this slips

export class RoverController {
  constructor(scene, field, gs, effects = null) {
    this.scene = scene;
    this.field = field;
    this.gs = gs;
    this.effects = effects;
    this.built = buildRover(gs.ship.seed);
    this.group = this.built.group;
    this.group.visible = false;
    scene.add(this.group);

    this.deployed = false;
    this.active = false;       // player is driving
    this.heading = 0;
    this.speed = 0;
    this._camPos = null;
    this._headlightsOn = false;

    // headlight spotlights
    this.spots = this.built.headlights.map((hl) => {
      const s = new THREE.SpotLight(0xfff2d8, 0, 40, 0.6, 0.4, 1.4);
      s.visible = false;
      this.group.add(s, s.target);
      return s;
    });

    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
  }

  get position() { return this.group.position; }

  /** place the rover on the ground a few metres ahead of the player */
  summon(nearPos, facing = 0) {
    const x = nearPos.x + Math.sin(facing) * 8;
    const z = nearPos.z + Math.cos(facing) * 8;
    if (Number.isFinite(this.field.seaY) && this.field.height(x, z) < this.field.seaY + 0.5) {
      events.emit('notify', { text: 'NO DRY GROUND TO DEPLOY THE EXOCRAFT', tone: 'warn' });
      audio.sfx('deny');
      return false;
    }
    this.group.position.set(x, this.field.height(x, z) + 0.5, z);
    this.heading = facing;
    this.speed = 0;
    this.deployed = true;
    this.group.visible = true;
    this.effects?.landingDust?.(this.group.position.clone());
    events.emit('notify', { text: `EXOCRAFT DEPLOYED — ${this.built.profile.name}`, tone: 'good' });
    audio.sfx('land');
    return true;
  }

  /** board — returns true if the rover is deployed and nearby */
  enter(player) {
    if (!this.deployed) return false;
    if (player.position.distanceTo(this.group.position) > 6) return false;
    this.active = true;
    audio.sfx('dock');
    events.emit('notify', { text: 'DRIVING — WASD steer · T lights · F disembark', tone: 'info' });
    return true;
  }

  exit(player) {
    this.active = false;
    audio.sfx('click');
    // step the player out beside the rover
    const side = this._tmp.set(Math.cos(this.heading), 0, -Math.sin(this.heading)).multiplyScalar(2.5);
    player.teleport(this.group.position.x + side.x, this.group.position.z + side.z);
  }

  update(dt, camera) {
    if (!this.active) { audio.engine(0); return; }

    // steering: sharper at low speed, wider at high
    const steerAuth = STEER * (1 - Math.min(0.6, Math.abs(this.speed) / TOP_SPEED * 0.6));
    if (input.action('left')) this.heading += steerAuth * dt * Math.sign(this.speed || 1);
    if (input.action('right')) this.heading -= steerAuth * dt * Math.sign(this.speed || 1);

    // throttle / brake / reverse
    if (input.action('forward')) this.speed += ACCEL * dt;
    else if (input.action('back')) this.speed -= (this.speed > 0 ? BRAKE : ACCEL * 0.6) * dt;
    else this.speed *= (1 - 1.6 * dt); // rolling friction
    this.speed = THREE.MathUtils.clamp(this.speed, -TOP_SPEED * 0.4, TOP_SPEED);

    // move along heading; slope resists/assists and cliffs block
    const fwd = this._tmp.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const nx = this.group.position.x + fwd.x * this.speed * dt;
    const nz = this.group.position.z + fwd.z * this.speed * dt;
    const n = this.field.normal(nx, nz, 1.2);
    if (n.y < MAX_CLIMB && this.speed > 0) {
      // too steep — bleed speed, slide back a little
      this.speed *= Math.max(0, 1 - 4 * dt);
    }
    // water hard stop
    if (Number.isFinite(this.field.seaY) && this.field.height(nx, nz) < this.field.seaY) {
      this.speed = 0;
      if (!this._warnedWater) { events.emit('notify', { text: 'THE EXOCRAFT IS NOT AMPHIBIOUS', tone: 'warn' }); this._warnedWater = true; }
    } else {
      this._warnedWater = false;
      this.group.position.x = nx;
      this.group.position.z = nz;
    }

    // suspension: sample the four wheel contacts, sit on the average, bank to slope
    let sumY = 0, count = 0;
    const nrm = this._n.set(0, 0, 0);
    for (const w of this.built.wheels) {
      const wx = this.group.position.x + Math.sin(this.heading) * w.sz * 1.05 + Math.cos(this.heading) * w.sx * 0.95;
      const wz = this.group.position.z + Math.cos(this.heading) * w.sz * 1.05 - Math.sin(this.heading) * w.sx * 0.95;
      const gy = this.field.height(wx, wz);
      sumY += gy; count++;
      nrm.add(this.field.normal(wx, wz, 1));
      // spin the wheels
      w.mesh.rotation.x += (this.speed / w.radius) * dt;
    }
    const avgY = sumY / count + w0Height();
    this.group.position.y += (avgY - this.group.position.y) * Math.min(1, dt * 8);
    nrm.normalize();
    // orient: up toward the terrain normal, yaw to heading
    const yawQ = new THREE.Quaternion().setFromAxisAngle(this._up, this.heading);
    const tiltQ = new THREE.Quaternion().setFromUnitVectors(this._up, nrm);
    this._q.copy(tiltQ).multiply(yawQ);
    this.group.quaternion.slerp(this._q, Math.min(1, dt * 6));

    // headlights
    if (input.actionPressed('torch')) {
      this._headlightsOn = !this._headlightsOn;
      audio.sfx('click');
    }
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      s.visible = this._headlightsOn;
      s.intensity = this._headlightsOn ? 120 : 0;
      s.position.copy(this.built.headlights[i].position);
      s.target.position.copy(this.built.headlights[i].position).add(new THREE.Vector3(0, -0.2, -6));
    }

    // engine hum scales with speed
    audio.engine(Math.min(0.6, Math.abs(this.speed) / TOP_SPEED * 0.6));

    // drift dust on hard turns
    if (this.effects && Math.abs(this.speed) > 12 && (input.action('left') || input.action('right')) && Math.random() < 0.3) {
      this.effects.landingDust?.(this.group.position.clone().addScaledVector(fwd, -1.5));
    }

    this._updateCamera(dt, camera, fwd);
  }

  _updateCamera(dt, camera, fwd) {
    const desired = this._tmp.set(
      this.group.position.x - fwd.x * 8.5,
      this.group.position.y + 4.2,
      this.group.position.z - fwd.z * 8.5,
    );
    if (!this._camPos) this._camPos = desired.clone();
    this._camPos.lerp(desired, 1 - Math.exp(-5 * dt));
    camera.position.copy(this._camPos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.group.position.x, this.group.position.y + 1.2, this.group.position.z);
  }

  dispose() {
    this.scene.remove(this.group);
    this.built.dispose();
    for (const s of this.spots) s.dispose?.();
  }
}

// wheel radius offset so the hull rides above the wheels
function w0Height() { return 0.5; }
