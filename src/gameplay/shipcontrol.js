// Arcade 6DOF flight model + chase camera. Mouse steers, W/S throttle,
// Q/E roll, Shift boost. Velocity chases the nose with lateral drift damping —
// responsive but weighty.
import * as THREE from 'three';
import { input } from '../core/input.js';

const BASE_SPEED = 55;          // units/s at full throttle (space scale)
const BOOST_MULT = 3.2;
const PITCH_RATE = 1.6, YAW_RATE = 1.1, ROLL_RATE = 2.2;

export class ShipController {
  /** @param {THREE.Object3D} shipGroup visual root (from buildShip().group) */
  constructor(shipGroup, { maxSpeed = BASE_SPEED, agility = 1 } = {}) {
    this.ship = shipGroup;
    this.maxSpeed = maxSpeed;
    this.agility = agility;
    this.velocity = new THREE.Vector3();
    this.throttle = 0;            // 0..1
    this.boost = false;
    this.angVel = new THREE.Vector3();  // pitch, yaw, roll rates
    this.enabled = true;
    this.camOffset = new THREE.Vector3(0, 2.4, 9.5);
    this.camLerp = 4.5;
    this._camPos = null;
    this._shake = 0;

    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._fwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  get position() { return this.ship.position; }
  get speed() { return this.velocity.length(); }
  get forward() { return this.ship.getWorldDirection(this._fwd).negate(); } // -Z nose

  /** brief camera shake (damage, warp) */
  shake(amount = 1) { this._shake = Math.min(2, this._shake + amount); }

  update(dt, camera) {
    if (this.enabled) {
      // -- steering --
      const sens = 0.0016 * this.agility;
      const targetPitch = THREE.MathUtils.clamp(-input.mouseDY * sens * 60, -PITCH_RATE, PITCH_RATE);
      const targetYaw = THREE.MathUtils.clamp(-input.mouseDX * sens * 60, -YAW_RATE, YAW_RATE);
      let targetRoll = 0;
      if (input.action('rollLeft')) targetRoll += ROLL_RATE;
      if (input.action('rollRight')) targetRoll -= ROLL_RATE;
      targetRoll += targetYaw * 0.8; // auto-bank into turns

      const t = 1 - Math.exp(-8 * dt);
      this.angVel.x += (targetPitch - this.angVel.x) * t;
      this.angVel.y += (targetYaw - this.angVel.y) * t;
      this.angVel.z += (targetRoll - this.angVel.z) * t;

      this._e.set(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'XYZ');
      this._q.setFromEuler(this._e);
      this.ship.quaternion.multiply(this._q);

      // -- throttle --
      if (input.action('forward')) this.throttle = Math.min(1, this.throttle + dt * 0.8);
      if (input.action('back')) this.throttle = Math.max(0, this.throttle - dt * 1.2);
      this.boost = input.action('boost') && this.throttle > 0.4;
    } else {
      this.throttle *= Math.max(0, 1 - dt * 2);
      this.boost = false;
    }

    // -- velocity chases the nose --
    const target = this.forward.clone().multiplyScalar(
      this.throttle * this.maxSpeed * (this.boost ? BOOST_MULT : 1)
    );
    // vertical strafe thrusters
    if (this.enabled) {
      const upAmt = (input.action('up') ? 1 : 0) - (input.action('down') ? 1 : 0);
      if (upAmt) target.addScaledVector(this.ship.up.clone().applyQuaternion(this.ship.quaternion), upAmt * this.maxSpeed * 0.25);
    }
    const vt = 1 - Math.exp(-(this.boost ? 1.6 : 2.6) * dt);
    this.velocity.lerp(target, vt);
    this.ship.position.addScaledVector(this.velocity, dt);

    this._updateCamera(dt, camera);
  }

  _updateCamera(dt, camera) {
    if (!camera) return;
    const desired = this._tmp.copy(this.camOffset)
      .applyQuaternion(this.ship.quaternion)
      .add(this.ship.position);
    if (!this._camPos) this._camPos = desired.clone();
    this._camPos.lerp(desired, 1 - Math.exp(-this.camLerp * dt));
    camera.position.copy(this._camPos);

    // look slightly ahead of the nose for a sense of motion
    const ahead = this.forward.clone().multiplyScalar(24).add(this.ship.position);
    camera.up.copy(this.ship.up).applyQuaternion(this.ship.quaternion);
    camera.lookAt(ahead);

    // boost FOV kick + shake
    const targetFov = this.boost ? 74 : 62;
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4 * dt));
    if (this._shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * this._shake * 0.35;
      camera.position.y += (Math.random() - 0.5) * this._shake * 0.35;
      this._shake *= Math.max(0, 1 - dt * 3.5);
    }
    camera.updateProjectionMatrix();
  }
}
