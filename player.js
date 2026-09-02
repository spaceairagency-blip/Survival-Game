import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * Player module
 * -------------
 * First-person camera controller with WASD movement, jumping, sprinting,
 * gravity, horizontal collision against world.collidables (trees, rocks,
 * houses, etc.), and resource gathering via raycasting from the camera
 * center.
 */

export class Player {
  constructor(camera, domElement, world) {
    this.camera = camera;
    this.world = world;
    this.controls = new PointerLockControls(camera, domElement);

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.move = { forward: false, backward: false, left: false, right: false, sprint: false };
    this.canJump = false;
    this.isSprinting = false;

    this.height = 1.7;
    this.radius = 0.4; // horizontal collision radius
    this.walkSpeed = 5.0;
    this.sprintSpeed = 8.5;
    this.jumpStrength = 7.0;
    this.gravity = 18.0;

    this.gatherRange = 3.2;
    this.raycaster = new THREE.Raycaster();

    // starting position
    this.controls.getObject().position.set(0, this.height, 5);

    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
    document.addEventListener('keyup', (e) => this._onKeyUp(e));
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.move.forward = true; break;
      case 'KeyS': case 'ArrowDown': this.move.backward = true; break;
      case 'KeyA': case 'ArrowLeft': this.move.left = true; break;
      case 'KeyD': case 'ArrowRight': this.move.right = true; break;
      case 'ShiftLeft': case 'ShiftRight': this.move.sprint = true; break;
      case 'Space':
        if (this.canJump) {
          this.velocity.y = this.jumpStrength;
          this.canJump = false;
        }
        break;
    }
  }

  _onKeyUp(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': this.move.forward = false; break;
      case 'KeyS': case 'ArrowDown': this.move.backward = false; break;
      case 'KeyA': case 'ArrowLeft': this.move.left = false; break;
      case 'KeyD': case 'ArrowRight': this.move.right = false; break;
      case 'ShiftLeft': case 'ShiftRight': this.move.sprint = false; break;
    }
  }

  getObject() {
    return this.controls.getObject();
  }

  lock() {
    this.controls.lock();
  }

  unlock() {
    this.controls.unlock();
  }

  isLocked() {
    return this.controls.isLocked;
  }

  /** Find the resource currently in crosshair range, if any */
  getTargetedResource() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const meshes = this.world.resources
      .filter(r => !r.gathered)
      .map(r => r.mesh);

    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;

    const hitObj = hits[0];
    if (hitObj.distance > this.gatherRange) return null;

    // find which resource this belongs to (walk up to the group root)
    let obj = hitObj.object;
    while (obj) {
      const found = this.world.resources.find(r => r.mesh === obj);
      if (found) return found;
      obj = obj.parent;
    }
    return null;
  }

  /** Find the chicken currently in crosshair range, if any (for hunting) */
  getTargetedChicken() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const meshes = this.world.chickens
      .filter(c => c.alive)
      .map(c => c.mesh);

    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;

    const hitObj = hits[0];
    if (hitObj.distance > this.gatherRange) return null;

    let obj = hitObj.object;
    while (obj) {
      const found = this.world.chickens.find(c => c.mesh === obj);
      if (found) return found;
      obj = obj.parent;
    }
    return null;
  }

  /** Returns a placement point in front of the player, on the ground, for building */
  getBuildPlacement(distance = 5) {
    const obj = this.getObject();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const point = obj.position.clone().add(forward.multiplyScalar(distance));
    const groundY = this.world.getGroundHeight(point.x, point.z);
    point.y = groundY;

    const yaw = Math.atan2(forward.x, forward.z) + Math.PI;
    return { position: point, yaw };
  }

  update(delta, staminaAvailable) {
    const obj = this.getObject();

    // Horizontal damping
    this.velocity.x -= this.velocity.x * 8.0 * delta;
    this.velocity.z -= this.velocity.z * 8.0 * delta;

    // Gravity
    this.velocity.y -= this.gravity * delta;

    this.direction.z = Number(this.move.forward) - Number(this.move.backward);
    this.direction.x = Number(this.move.right) - Number(this.move.left);
    this.direction.normalize();

    this.isSprinting = this.move.sprint && staminaAvailable && this.direction.z > 0;
    const speed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

    if (this.move.forward || this.move.backward) this.velocity.z -= this.direction.z * speed * 10.0 * delta;
    if (this.move.left || this.move.right) this.velocity.x -= this.direction.x * speed * 10.0 * delta;

    // Use PointerLockControls' own moveForward/moveRight (these already
    // account for look direction correctly), then resolve collisions
    // per-axis by reverting if the move would intersect a collidable.
    const forwardDelta = -this.velocity.z * delta;
    const rightDelta = -this.velocity.x * delta;

    const prevX1 = obj.position.x, prevZ1 = obj.position.z;
    this.controls.moveForward(forwardDelta);
    if (this._collidesAt(obj.position.x, obj.position.z)) {
      obj.position.x = prevX1;
      obj.position.z = prevZ1;
    }

    const prevX2 = obj.position.x, prevZ2 = obj.position.z;
    this.controls.moveRight(rightDelta);
    if (this._collidesAt(obj.position.x, obj.position.z)) {
      obj.position.x = prevX2;
      obj.position.z = prevZ2;
    }

    obj.position.y += this.velocity.y * delta;

    // Ground collision using world height sampling
    const groundY = this.world.getGroundHeight(obj.position.x, obj.position.z) + this.height;
    if (obj.position.y <= groundY) {
      this.velocity.y = 0;
      obj.position.y = groundY;
      this.canJump = true;
    }

    // Soft world boundary
    const boundary = 195;
    obj.position.x = THREE.MathUtils.clamp(obj.position.x, -boundary, boundary);
    obj.position.z = THREE.MathUtils.clamp(obj.position.z, -boundary, boundary);

    return this.isSprinting;
  }

    _collidesAt(x, z) {
    const collidables = this.world.collidables;
    if (!collidables || collidables.length === 0) return false;

    for (const obj of collidables) {
      if (obj.userData._collisionRadius === undefined) {
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        box.getSize(size);

        // Trees/rocks/bushes should only block on their trunk/base width,
        // not their full leafy canopy — use a trunk-scale radius for small
        // resource props, and the full footprint only for large structures
        // like houses/campfires.
        const isLargeStructure = obj.userData.buildingType === 'house'
          || obj.userData.buildingType === 'campfire';

        let radius;
        if (isLargeStructure) {
          radius = Math.sqrt(size.x * size.x + size.z * size.z) * 0.5;
        } else {
          // Use average of x/z (not diagonal) and shrink further — trunk-width collision
          radius = Math.max((size.x + size.z) / 4, 0.35) * 0.6;
        }

        obj.userData._collisionRadius = Math.max(radius, 0.35);
      }
      const r = obj.userData._collisionRadius + this.radius;
      const dx = x - obj.position.x;
      const dz = z - obj.position.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
}
