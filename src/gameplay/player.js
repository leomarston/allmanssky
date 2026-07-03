// On-foot first-person controller: mouse look, walk/sprint with real
// acceleration, jump, jetpack, slope resistance, footsteps, landing impact —
// terrain collision against the TerrainField height authority.
import * as THREE from 'three';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { audio } from '../audio/audio.js';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 5.2;
const SPRINT_MULT = 1.65;
const JUMP_SPEED = 6.0;
const JET_ACCEL = 16.0;
const JET_DRAIN = 0.45;     // charge/s while thrusting
const JET_REGEN = 0.35;     // charge/s on ground
const AIR_CONTROL = 0.25;

export class PlayerController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('../universe/terrainfield.js').TerrainField} field
   * @param {number} gravityG planet gravity in g
   */
  constructor(camera, field, gravityG = 1) {
    this.camera = camera;
    this.field = field;
    this.gravity = gravityG * 9.81;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.jetpack = 1;
    this.sensitivity = 0.0023;
    this.enabled = true;
    this.headBobPhase = 0;
    this._wasJetting = false;
    this._stepPhase = 0;       // footstep cycle
    this._landDip = 0;         // camera dip after a hard landing
    this._baseFov = camera.fov;
  }

  teleport(x, z, yOffset = 0.5) {
    this.position.set(x, this.field.height(x, z) + yOffset, z);
    this.velocity.set(0, 0, 0);
  }

  /** horizontal speed for HUD / audio */
  get speed() { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt) {
    if (!this.enabled) { this._apply(dt); return; }

    // look: mouse deltas + arrow keys (keyboard turning needs no mouse)
    this.yaw -= input.mouseDX * this.sensitivity + input.lookX * 2.1 * dt;
    this.pitch -= input.mouseDY * this.sensitivity + input.lookY * 1.6 * dt;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));

    // wish direction in world space from yaw
    let fx = 0, fz = 0;
    if (input.action('forward')) fz += 1;
    if (input.action('back')) fz -= 1;
    if (input.action('left')) fx -= 1;
    if (input.action('right')) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos - fz * sin;
    const wishZ = -fx * sin - fz * cos;

    const sprinting = input.action('sprint') && fz > 0;
    let targetSpeed = WALK_SPEED * (sprinting ? SPRINT_MULT : 1);

    // slope resistance: climbing steep ground is slower, descending eases you on
    if ((fx || fz) && this.onGround) {
      const n = this.field.normal(this.position.x, this.position.z);
      const uphill = -(n.x * wishX + n.z * wishZ); // >0 when the slope rises ahead
      targetSpeed *= THREE.MathUtils.clamp(1 - uphill * 1.4, 0.45, 1.12);
    }

    if (this.onGround) {
      // heavier start/stop than pure exponential snap — walking has mass
      const t = 1 - Math.exp(-8.5 * dt);
      this.velocity.x += (wishX * targetSpeed - this.velocity.x) * t;
      this.velocity.z += (wishZ * targetSpeed - this.velocity.z) * t;
      if (input.actionPressed('jump')) {
        this.velocity.y = JUMP_SPEED * Math.min(1.15, 1 / Math.sqrt(this.gravity / 9.81));
        this.onGround = false;
        events.emit('audio:play', 'jetpack', { volume: 0.3 });
      }
    } else {
      this.velocity.x += wishX * targetSpeed * AIR_CONTROL * dt * 6;
      this.velocity.z += wishZ * targetSpeed * AIR_CONTROL * dt * 6;
      // jetpack: hold jump in air
      if (input.action('jump') && this.jetpack > 0) {
        this.velocity.y += JET_ACCEL * dt;
        this.velocity.y = Math.min(this.velocity.y, 9);
        this.jetpack = Math.max(0, this.jetpack - JET_DRAIN * dt);
        if (!this._wasJetting) events.emit('player:jetpack', true);
        this._wasJetting = true;
      } else if (this._wasJetting) {
        events.emit('player:jetpack', false);
        this._wasJetting = false;
      }
    }

    this.velocity.y -= this.gravity * dt;
    const fallSpeed = -this.velocity.y;
    this._apply(dt);

    // ground collision via height authority
    const groundY = this.field.height(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      if (!this.onGround) {
        // landing impact: camera dip + thud scale with fall speed
        if (fallSpeed > 4) {
          this._landDip = Math.min(0.34, fallSpeed * 0.022);
          audio.sfx('land', { volume: Math.min(1, fallSpeed / 16) });
        }
        if (fallSpeed > 12) events.emit('audio:play', 'land');
      }
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
      if (this._wasJetting) { events.emit('player:jetpack', false); this._wasJetting = false; }
    } else if (this.position.y > groundY + 0.05) {
      this.onGround = false;
    }
    if (this.onGround) this.jetpack = Math.min(1, this.jetpack + JET_REGEN * dt);

    // ---- camera: bob, sway, footsteps, landing dip, sprint FOV ----------------
    const moving = this.onGround && this.speed > 0.5;
    const speed01 = Math.min(1, this.speed / (WALK_SPEED * SPRINT_MULT));
    if (moving) {
      const prev = this.headBobPhase;
      this.headBobPhase += dt * (5.4 + 5.2 * speed01);
      // a footstep on each half-cycle (each foot), softer at a stroll
      if (Math.floor(prev / Math.PI) !== Math.floor(this.headBobPhase / Math.PI)) {
        audio.sfx('footstep', { volume: 0.35 + speed01 * 0.65 });
      }
    }
    const bobY = moving ? Math.sin(this.headBobPhase * 2) * (0.028 + 0.03 * speed01) : 0;
    const swayX = moving ? Math.sin(this.headBobPhase) * (0.014 + 0.016 * speed01) : 0;
    this._landDip = Math.max(0, this._landDip - dt * 0.9);
    const dip = this._landDip * Math.sin(Math.min(1, this._landDip / 0.34) * Math.PI);

    const cos2 = Math.cos(this.yaw), sin2 = Math.sin(this.yaw);
    this.camera.position.set(
      this.position.x + swayX * cos2,
      this.position.y + EYE_HEIGHT + bobY - dip,
      this.position.z - swayX * sin2,
    );
    this.camera.quaternion.setFromEuler(new THREE.Euler(
      this.pitch, this.yaw, moving ? Math.sin(this.headBobPhase) * 0.006 : 0, 'YXZ'));

    // gentle FOV push while sprinting
    const wantFov = this._baseFov + (sprinting && moving ? 4.5 : 0);
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 5);
      this.camera.updateProjectionMatrix();
    }
  }

  _apply(dt) {
    this.position.addScaledVector(this.velocity, dt);
  }
}
