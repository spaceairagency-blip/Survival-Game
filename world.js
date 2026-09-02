import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * World module
 * -------------
 * Simple, reliable procedural terrain (no external field model — removed
 * per request since it was unreliable). Ground is a flat-ish grass plane
 * sampled via raycasting for height. Scatters trees/rocks/bushes/ponds
 * directly onto it (always succeeds, no async dependency). Spawns a
 * chicken model (easy one-hit kill) and two free pre-built starter houses.
 */

export const CHICKEN_MODEL_PATH = 'assets/chicken/scene.gltf';
const CHICKEN_TARGET_SIZE = 0.9;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.resources = [];       // gatherable objects {mesh, type, amount}
    this.collidables = [];     // objects the player collides with (blocks movement)
    this.buildings = [];       // placed house-system structures
    this.chickens = [];        // huntable chicken NPCs
    this._chickenTemplate = null;

    this.dayLength = 240; // seconds per full day/night cycle
    this.time = 0.25;     // 0 = midnight, 0.25 = sunrise, 0.5 = noon

    this._groundRaycaster = new THREE.Raycaster();

    this._setupLighting();
    this._setupSky();
    this._setupGround();
    this._scatterResources();
    this._scatterWater();
    this._placeStarterHouses();
    this._loadChickenModel();
  }

  _setupLighting() {
    this.ambient = new THREE.HemisphereLight(0xaee4ff, 0x3a2f1c, 0.7);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff2d1, 1.4);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -100;
    this.sun.shadow.camera.right = 100;
    this.sun.shadow.camera.top = 100;
    this.sun.shadow.camera.bottom = -100;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _setupSky() {
    this.scene.background = new THREE.Color(0x8ecbff);
    this.scene.fog = new THREE.FogExp2(0xbfe3ff, 0.012);
  }

  _setupGround() {
    const groundGeo = new THREE.PlaneGeometry(400, 400, 64, 64);
    groundGeo.rotateX(-Math.PI / 2);

    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 1.2
               + Math.sin(x * 0.15 + z * 0.1) * 0.4;
      pos.setY(i, h);
    }
    groundGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x5d8a3a,
      roughness: 1,
      metalness: 0,
    });

    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.scene.add(this.ground);
  }

  getGroundHeight(x, z) {
    this._groundRaycaster.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
    const hits = this._groundRaycaster.intersectObject(this.ground, false);
    if (hits.length > 0) return hits[0].point.y;
    return 0;
  }

  update(delta, playerPos) {
    this.time += delta / this.dayLength;
    if (this.time > 1) this.time -= 1;
    this._applyTimeOfDay();

    for (const res of this.resources) {
      if (res.gathered && !res.infinite) {
        res.timer += delta;
        if (res.timer >= res.respawnTime) {
          res.gathered = false;
          res.timer = 0;
          res.mesh.visible = true;
        }
      }
    }

    if (playerPos) this._updateChickens(delta, playerPos);
  }

  _applyTimeOfDay() {
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const radius = 100;
    this.sun.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 30);
    this.sun.target.position.set(0, 0, 0);

    const dayFactor = Math.max(0, Math.sin(this.time * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
    this.sun.intensity = 0.15 + dayFactor * 1.3;
    this.ambient.intensity = 0.2 + dayFactor * 0.6;

    const skyDay = new THREE.Color(0x8ecbff);
    const skyNight = new THREE.Color(0x0a0e2a);
    const sky = skyNight.clone().lerp(skyDay, dayFactor);
    this.scene.background = sky;
    this.scene.fog.color = sky;
  }

  setTime(fraction) {
    this.time = ((fraction % 1) + 1) % 1;
    this._applyTimeOfDay();
  }

  getClockLabel() {
    const totalMinutes = Math.floor(this.time * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  isDaytime() {
    return this.time > 0.22 && this.time < 0.78;
  }

  // ---------- Resource scattering (always succeeds — plain procedural ground) ----------

  _randomSpot(clearRadius = 8) {
    const x = (Math.random() - 0.5) * 300;
    const z = (Math.random() - 0.5) * 300;
    if (Math.abs(x) < clearRadius && Math.abs(z) < clearRadius) return this._randomSpot(clearRadius);
    return { x, y: this.getGroundHeight(x, z), z };
  }

  _scatterResources() {
    for (let i = 0; i < 40; i++) {
      const s = this._randomSpot(10);
      const tree = this._createTree();
      tree.position.set(s.x, s.y, s.z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(tree);
      this.resources.push({ mesh: tree, type: 'wood', amount: 5, respawnTime: 30, gathered: false, timer: 0 });
      this.collidables.push(tree);
    }

    for (let i = 0; i < 30; i++) {
      const s = this._randomSpot(10);
      const rock = this._createRock();
      rock.position.set(s.x, s.y, s.z);
      rock.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(rock);
      this.resources.push({ mesh: rock, type: 'stone', amount: 3, respawnTime: 25, gathered: false, timer: 0 });
      this.collidables.push(rock);
    }

    for (let i = 0; i < 25; i++) {
      const s = this._randomSpot(10);
      const bush = this._createBush();
      bush.position.set(s.x, s.y, s.z);
      this.scene.add(bush);
      this.resources.push({ mesh: bush, type: 'berry', amount: 3, respawnTime: 20, gathered: false, timer: 0 });
    }
  }

  _scatterWater() {
    for (let i = 0; i < 3; i++) {
      const s = this._randomSpot(20);
      const geo = new THREE.CircleGeometry(6 + Math.random() * 4, 24);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a72c9, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85,
      });
      const pond = new THREE.Mesh(geo, mat);
      pond.position.set(s.x, s.y + 0.05, s.z);
      pond.name = 'water';
      this.scene.add(pond);
      this.resources.push({ mesh: pond, type: 'water', amount: 999, respawnTime: 0, gathered: false, timer: 0, infinite: true });
    }
  }

  _createTree() {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 1 })
    );
    trunk.position.y = 1.5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 3.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1 })
    );
    leaves.position.y = 4;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(leaves);

    group.userData.type = 'wood';
    return group;
  }

  _createRock() {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.6 + Math.random() * 0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, flatShading: true })
    );
    rock.position.y = 0.3;
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData.type = 'stone';
    return rock;
  }

  _createBush() {
    const group = new THREE.Group();
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 1 })
    );
    bush.position.y = 0.6;
    bush.castShadow = true;
    bush.receiveShadow = true;
    group.add(bush);

    for (let i = 0; i < 5; i++) {
      const berry = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xc41e3a, roughness: 0.5 })
      );
      const angle = Math.random() * Math.PI * 2;
      berry.position.set(Math.cos(angle) * 0.6, 0.6 + Math.random() * 0.4, Math.sin(angle) * 0.6);
      group.add(berry);
    }
    group.userData.type = 'berry';
    return group;
  }

  // ---------- Chickens (huntable NPCs — one hit kills them) ----------

  _loadChickenModel() {
    const loader = new GLTFLoader();
    loader.load(
      CHICKEN_MODEL_PATH,
      (gltf) => {
        const template = gltf.scene;
        template.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const box = new THREE.Box3().setFromObject(template);
        const size = new THREE.Vector3();
        box.getSize(size);
        const largest = Math.max(size.x, size.y, size.z) || 1;
        const scale = CHICKEN_TARGET_SIZE / largest;
        template.scale.setScalar(scale);

        const box2 = new THREE.Box3().setFromObject(template);
        template.userData.footOffset = -box2.min.y;

        this._chickenTemplate = template;
        this._spawnChickens();
        console.log('[World] Chicken model loaded — scale factor:', scale.toFixed(4));
      },
      undefined,
      (err) => {
        console.error('[World] Chicken model failed to load from', CHICKEN_MODEL_PATH, '— spawning fallback chickens instead.', err);
        this._spawnFallbackChickens();
      }
    );
  }

  _spawnChickens(count = 16) {
    if (!this._chickenTemplate) return;
    for (let i = 0; i < count; i++) {
      const s = this._randomSpot(15);
      const mesh = this._chickenTemplate.clone(true);
      mesh.position.set(s.x, s.y + this._chickenTemplate.userData.footOffset, s.z);
      mesh.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(mesh);
      this.chickens.push(this._makeChickenEntry(mesh));
    }
    console.log(`[World] Spawned ${this.chickens.length} chickens.`);
  }

  /** Fallback simple chicken shape in case the model fails to load, so hunting always works */
  _spawnFallbackChickens(count = 16) {
    for (let i = 0; i < count; i++) {
      const s = this._randomSpot(15);
      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 1 })
      );
      body.position.y = 0.3;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 1 })
      );
      head.position.set(0, 0.5, 0.2);
      group.add(head);
      const beak = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.12, 6),
        new THREE.MeshStandardMaterial({ color: 0xe0a020, roughness: 1 })
      );
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.48, 0.34);
      group.add(beak);

      group.position.set(s.x, s.y, s.z);
      group.rotation.y = Math.random() * Math.PI * 2;
      group.userData.footOffset = 0;
      this.scene.add(group);
      this.chickens.push(this._makeChickenEntry(group));
    }
    if (!this._chickenTemplate) this._chickenTemplate = { userData: { footOffset: 0 } };
    console.log(`[World] Spawned ${this.chickens.length} fallback chickens.`);
  }

  _makeChickenEntry(mesh) {
    return {
      mesh,
      alive: true,
      health: 1, // one hit kills it
      wanderTarget: mesh.position.clone(),
      wanderTimer: Math.random() * 3,
      speed: 1.2 + Math.random() * 0.6,
      fleeing: false,
    };
  }

  _updateChickens(delta, playerPos) {
    for (const c of this.chickens) {
      if (!c.alive) continue;

      const distToPlayer = c.mesh.position.distanceTo(playerPos);
      c.fleeing = distToPlayer < 6;

      c.wanderTimer -= delta;
      if (c.fleeing) {
        const away = c.mesh.position.clone().sub(playerPos);
        away.y = 0;
        if (away.lengthSq() > 0.0001) away.normalize();
        c.wanderTarget = c.mesh.position.clone().add(away.multiplyScalar(6));
      } else if (c.wanderTimer <= 0) {
        c.wanderTimer = 2 + Math.random() * 3;
        const angle = Math.random() * Math.PI * 2;
        const dist = 3 + Math.random() * 6;
        c.wanderTarget = c.mesh.position.clone().add(
          new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
        );
      }

      const toTarget = c.wanderTarget.clone().sub(c.mesh.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      if (dist > 0.2) {
        toTarget.normalize();
        const step = Math.min(dist, c.speed * (c.fleeing ? 1.8 : 1) * delta);
        c.mesh.position.addScaledVector(toTarget, step);
        c.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
      }

      c.mesh.position.y = this.getGroundHeight(c.mesh.position.x, c.mesh.position.z)
        + (this._chickenTemplate?.userData?.footOffset || 0);
    }
  }

  /** Damages a chicken; one hit always kills it. Returns true if it died. */
  hitChicken(chickenEntry, damage = 1) {
    if (!chickenEntry.alive) return false;
    chickenEntry.health -= damage;
    if (chickenEntry.health <= 0) {
      chickenEntry.alive = false;
      chickenEntry.mesh.visible = false;
      return true;
    }
    return false;
  }

  // ---------- House system ----------

  /** Places two pre-built, free starter houses near spawn so the player has
   *  immediate shelter without needing to gather materials first. */
  _placeStarterHouses() {
    const spots = [
      { x: 14, z: -10, yaw: Math.PI * 0.15 },
      { x: -16, z: -12, yaw: -Math.PI * 0.2 },
    ];
    for (const spot of spots) {
      const y = this.getGroundHeight(spot.x, spot.z);
      this.placeHouse(new THREE.Vector3(spot.x, y, spot.z), spot.yaw, true);
    }
  }

  placeHouse(position, yaw = 0, free = false) {
    const mesh = this._createHouseTier(1);
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    this.collidables.push(mesh);

    const building = { type: 'house', tier: 1, mesh, position: position.clone(), yaw, free };
    this.buildings.push(building);
    return building;
  }

  upgradeHouse(building) {
    if (building.tier >= 3) return false;
    const idx = this.collidables.indexOf(building.mesh);
    this.scene.remove(building.mesh);
    if (idx !== -1) this.collidables.splice(idx, 1);

    building.tier += 1;
    const mesh = this._createHouseTier(building.tier);
    mesh.position.copy(building.position);
    mesh.rotation.y = building.yaw;
    this.scene.add(mesh);
    this.collidables.push(mesh);
    building.mesh = mesh;
    return true;
  }

  getNearestHouse(position, maxDist = 6) {
    let nearest = null;
    let nearestDist = maxDist;
    for (const b of this.buildings) {
      if (b.type !== 'house') continue;
      const d = position.distanceTo(b.position);
      if (d < nearestDist) {
        nearest = b;
        nearestDist = d;
      }
    }
    return nearest;
  }

  _createHouseTier(tier) {
    const group = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: tier >= 3 ? 0xb0b0ad : 0xc9a06a, roughness: 1 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a3f2e, roughness: 1 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x7a7a76, roughness: 1 });

    const size = 6 + (tier - 1) * 1.5;
    const wallHeight = 3 + (tier - 1) * 0.4;

    const base = new THREE.Mesh(new THREE.BoxGeometry(size, wallHeight, size), wallMat);
    base.position.y = wallHeight / 2;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(size * 0.8, 2.5, 4), roofMat);
    roof.position.y = wallHeight + 1.25;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x4a2c17, roughness: 1 })
    );
    door.position.set(0, 1, size / 2 + 0.05);
    group.add(door);

    if (tier >= 2) {
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(size + 2, 0.2, size + 2),
        new THREE.MeshStandardMaterial({ color: 0x8a6339, roughness: 1 })
      );
      floor.position.y = 0.1;
      floor.receiveShadow = true;
      group.add(floor);
    }

    if (tier >= 3) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(size + 0.4, 0.6, size + 0.4), trimMat);
      trim.position.y = 0.3;
      trim.castShadow = true;
      trim.receiveShadow = true;
      group.add(trim);

      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8), trimMat);
      chimney.position.set(size * 0.25, wallHeight + 1.8, size * 0.25);
      group.add(chimney);
    }

    group.userData.buildingType = 'house';
    group.userData.tier = tier;
    return group;
  }

  // ---------- Campfire (for cooking raw meat) ----------

  placeCampfire(position, yaw = 0) {
    const mesh = this._createCampfire();
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    this.collidables.push(mesh);
    const building = { type: 'campfire', mesh, position: position.clone(), yaw };
    this.buildings.push(building);
    return building;
  }

  getNearestCampfire(position, maxDist = 5) {
    let nearest = null;
    let nearestDist = maxDist;
    for (const b of this.buildings) {
      if (b.type !== 'campfire') continue;
      const d = position.distanceTo(b.position);
      if (d < nearestDist) {
        nearest = b;
        nearestDist = d;
      }
    }
    return nearest;
  }

  _createCampfire() {
    const group = new THREE.Group();
    const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = (Math.PI / 4) * i;
      log.position.y = 0.15;
      log.castShadow = true;
      group.add(log);
    }
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.9, 8),
      new THREE.MeshStandardMaterial({ color: 0xff8c2e, emissive: 0xff5500, emissiveIntensity: 1.2 })
    );
    fire.position.y = 0.6;
    group.add(fire);

    const light = new THREE.PointLight(0xffa040, 1.5, 12, 2);
    light.position.y = 0.8;
    group.add(light);

    group.userData.buildingType = 'campfire';
    return group;
  }
}
