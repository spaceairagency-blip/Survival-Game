import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { SurvivalSystem, HOUSE_TIERS, CAMPFIRE_RECIPE } from './survival.js';

/**
 * main.js
 * -------
 * Bootstraps the renderer, scene, camera, and ties together World,
 * Player, and SurvivalSystem into the game loop. Handles UI screens
 * (loading, menu, death, HUD), gathering, hunting chickens, the
 * inventory modal, the build menu (house + campfire) + placement flow,
 * house upgrades, campfire cooking, eat/drink prompts, and sleep.
 */

// ---------- DOM refs ----------
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const loadingText = document.getElementById('loading-text');
const menuOverlay = document.getElementById('menu-overlay');
const deathOverlay = document.getElementById('death-overlay');
const hud = document.getElementById('hud');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const survivedTimeEl = document.getElementById('survived-time');
const interactPrompt = document.getElementById('interact-prompt');

const inventoryModal = document.getElementById('inventory-modal');
const inventoryGrid = document.getElementById('inventory-grid');
const inventoryToggleBtn = document.getElementById('inventory-toggle-btn');

const buildModal = document.getElementById('build-modal');
const buildGrid = document.getElementById('build-grid');
const buildToggleBtn = document.getElementById('build-toggle-btn');

const houseModal = document.getElementById('house-modal');
const houseModalTitle = document.getElementById('house-modal-title');
const houseModalInfo = document.getElementById('house-modal-info');
const houseUpgradeBtn = document.getElementById('house-upgrade-btn');

const eatPromptBtn = document.getElementById('eat-prompt');
const drinkPromptBtn = document.getElementById('drink-prompt');
const sleepBtn = document.getElementById('sleep-btn');

const ALL_MODALS = [inventoryModal, buildModal, houseModal];

// ---------- Renderer / Scene / Camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

// ---------- Simulate loading progress while world initializes ----------
let fakeProgress = 0;
const loadingInterval = setInterval(() => {
  fakeProgress += Math.random() * 12;
  if (fakeProgress > 92) fakeProgress = 92;
  progressFill.style.width = `${fakeProgress}%`;
}, 120);

// ---------- Build world & player ----------
const world = new World(scene);
const player = new Player(camera, renderer.domElement, world);
scene.add(player.getObject());

let dayNumber = 1;
let lastIsDaytime = world.isDaytime();

const survival = new SurvivalSystem(onPlayerDeath);

// Build-placement mode: null, or 'house' / 'campfire'
let activeBuildType = null;

// finish "loading" shortly after setup (gives GLTF loaders a moment to try the field/chicken models)
setTimeout(() => {
  clearInterval(loadingInterval);
  progressFill.style.width = '100%';
  loadingText.textContent = 'Ready!';
  setTimeout(() => {
    loadingScreen.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  }, 350);
}, 900);

// ---------- Pointer lock / menu flow ----------
startBtn.addEventListener('click', () => {
  player.lock();
});

restartBtn.addEventListener('click', () => {
  restartGame();
  player.lock();
});

player.controls.addEventListener('lock', () => {
  menuOverlay.classList.add('hidden');
  deathOverlay.classList.add('hidden');
  hud.classList.remove('hidden');
});

player.controls.addEventListener('unlock', () => {
  const anyModalOpen = ALL_MODALS.some((m) => !m.classList.contains('hidden'));
  if (!survival.isDead && !anyModalOpen) {
    hud.classList.add('hidden');
    menuOverlay.classList.remove('hidden');
  }
});

function onPlayerDeath() {
  hud.classList.add('hidden');
  survivedTimeEl.textContent = `You survived ${survival.formatTime()}`;
  deathOverlay.classList.remove('hidden');
  player.unlock();
}

function restartGame() {
  survival.reset();
  const obj = player.getObject();
  obj.position.set(0, player.height, 5);
  player.velocity.set(0, 0, 0);
  deathOverlay.classList.add('hidden');
  activeBuildType = null;
}

// ---------- Gathering & hunting interaction ----------
function tryGather() {
  if (!player.isLocked() || survival.isDead) return;

  // Prefer a chicken kill if one is targeted, otherwise gather resources
  const chicken = player.getTargetedChicken();
  if (chicken) {
    const died = world.hitChicken(chicken, 1);
    if (died) {
      survival.addItem('rawMeat', 1);
      survival.showToast('+1 Raw Meat');
    } else {
      survival.showToast('Hit!');
    }
    return;
  }

  const target = player.getTargetedResource();
  if (!target) return;

  if (target.infinite) {
    // water source — always gatherable
    survival.addItem('water', 1);
    survival.showToast('+1 Water');
    return;
  }

  if (target.gathered) return;

  survival.addItem(target.type, target.amount);
  survival.showToast(`+${target.amount} ${capitalize(target.type)}`);

  target.gathered = true;
  target.timer = 0;
  target.mesh.visible = false;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

document.addEventListener('click', () => {
  if (!player.isLocked()) return;

  // If in build-placement mode, place the structure instead of gathering
  if (activeBuildType) {
    tryPlaceBuilding();
    return;
  }

  tryGather();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') tryInteractOrGather();
  if (e.code === 'KeyI') toggleModal(inventoryModal, true);
  if (e.code === 'KeyB') toggleModal(buildModal, true);
  if (e.code === 'Escape') {
    cancelBuildMode();
    ALL_MODALS.forEach((m) => toggleModal(m, false));
  }
});

// ---------- E key: gather, or interact with nearby house/campfire ----------
function tryInteractOrGather() {
  if (!player.isLocked() || survival.isDead) return;

  const playerPos = player.getObject().position;
  const nearHouse = world.getNearestHouse(playerPos, 6);
  if (nearHouse) {
    openHouseModal(nearHouse);
    return;
  }

  const nearCampfire = world.getNearestCampfire(playerPos, 5);
  if (nearCampfire) {
    if (survival.inventory.rawMeat > 0) {
      survival.cookMeat();
    } else {
      survival.showToast('No raw meat to cook.');
    }
    return;
  }

  tryGather();
}

// ---------- Interact prompt (crosshair / proximity feedback) ----------
function updateInteractPrompt() {
  if (!player.isLocked() || activeBuildType) {
    interactPrompt.classList.add('hidden');
    return;
  }

  const playerPos = player.getObject().position;
  const nearHouse = world.getNearestHouse(playerPos, 6);
  if (nearHouse) {
    interactPrompt.textContent = 'Press E to view your house';
    interactPrompt.classList.remove('hidden');
    return;
  }

  const nearCampfire = world.getNearestCampfire(playerPos, 5);
  if (nearCampfire) {
    interactPrompt.textContent = survival.inventory.rawMeat > 0
      ? 'Press E to cook raw meat'
      : 'Campfire (no raw meat to cook)';
    interactPrompt.classList.remove('hidden');
    return;
  }

  const chicken = player.getTargetedChicken();
  if (chicken) {
    interactPrompt.textContent = 'Press E or click to hunt';
    interactPrompt.classList.remove('hidden');
    return;
  }

  const target = player.getTargetedResource();
  if (target && (!target.gathered || target.infinite)) {
    interactPrompt.textContent = 'Press E to interact';
    interactPrompt.classList.remove('hidden');
  } else {
    interactPrompt.classList.add('hidden');
  }
}

// ---------- Inventory modal ----------
const INVENTORY_DISPLAY = [
  { key: 'wood', name: 'Wood', edible: false, iconType: 'wood' },
  { key: 'stone', name: 'Stone', edible: false, iconType: 'stone' },
  { key: 'berry', icon: '🍓', name: 'Berries', edible: true, action: 'eat' },
  { key: 'water', icon: '💧', name: 'Water', edible: true, action: 'drink' },
  { key: 'rawMeat', icon: '🥩', name: 'Raw Meat', edible: false },
  { key: 'cookedMeat', icon: '🍖', name: 'Cooked Meat', edible: true, action: 'eat' },
];

const WOOD_SVG = '<svg viewBox="0 0 24 24" width="28" height="28"><rect x="2" y="9" width="20" height="6" rx="2" fill="#a9724b" stroke="#6b4226" stroke-width="1"/><ellipse cx="3.2" cy="12" rx="1.2" ry="2.4" fill="#c98f63" stroke="#6b4226" stroke-width="0.6"/><ellipse cx="20.8" cy="12" rx="1.2" ry="2.4" fill="#c98f63" stroke="#6b4226" stroke-width="0.6"/></svg>';
const STONE_SVG = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 14l2-6 5-3 5 2 4 3-1 6-6 3-6-1z" fill="#9a9a9a" stroke="#6d6d6d" stroke-width="1"/></svg>';

function renderInventoryModal() {
  inventoryGrid.innerHTML = '';
  for (const item of INVENTORY_DISPLAY) {
    const count = survival.inventory[item.key] || 0;
    const div = document.createElement('div');
    div.className = 'modal-item' + (item.edible && count > 0 ? '' : item.edible ? ' disabled' : '');
    const iconHtml = item.iconType === 'wood' ? WOOD_SVG
      : item.iconType === 'stone' ? STONE_SVG
      : `<span class="item-icon">${item.icon}</span>`;
    div.innerHTML = `
      ${iconHtml}
      <span class="item-name">${item.name}</span>
      <span class="item-count">x${count}</span>
    `;
    if (item.edible) {
      div.addEventListener('click', () => {
        if (count <= 0) return;
        if (item.action === 'eat') survival.eatFood();
        if (item.action === 'drink') survival.drinkWater();
        renderInventoryModal();
      });
    }
    inventoryGrid.appendChild(div);
  }
}

function toggleModal(modal, forceOpen) {
  const isOpen = !modal.classList.contains('hidden');
  const shouldOpen = forceOpen === undefined ? !isOpen : forceOpen;

  if (shouldOpen && !player.isLocked() && !survival.isDead) return; // don't open from menu

  if (shouldOpen) {
    if (modal === inventoryModal) renderInventoryModal();
    if (modal === buildModal) renderBuildModal();
    modal.classList.remove('hidden');
    player.unlock();
  } else {
    modal.classList.add('hidden');
  }
}

inventoryToggleBtn.addEventListener('mousedown', (e) => {
  e.stopPropagation();
  if (player.isLocked()) player.unlock();
});
inventoryToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleModal(inventoryModal, true);
});
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-close');
    document.getElementById(targetId).classList.add('hidden');
    player.lock();
  });
});

// ---------- Build menu (House + Campfire) ----------
function renderBuildModal() {
  buildGrid.innerHTML = '';

  // House (tier 1 hut — upgrades happen later via the house modal)
  const houseCanAfford = survival.canBuildHouse();
  const houseDiv = document.createElement('div');
  houseDiv.className = 'modal-item' + (houseCanAfford ? '' : ' disabled');
  const houseCostText = Object.entries(HOUSE_TIERS[1].cost).map(([k, v]) => `${v} ${k}`).join(', ');
  houseDiv.innerHTML = `
    <span class="item-icon">🏠</span>
    <span class="item-name">${HOUSE_TIERS[1].label}</span>
    <span class="item-cost">${houseCostText}</span>
  `;
  houseDiv.addEventListener('click', () => {
    if (!houseCanAfford) return;
    activeBuildType = 'house';
    buildModal.classList.add('hidden');
    player.lock();
    survival.showToast('Selected House — click in the world to place it.');
  });
  buildGrid.appendChild(houseDiv);

  // Campfire
  const campfireCanAfford = survival.canBuildCampfire();
  const campfireDiv = document.createElement('div');
  campfireDiv.className = 'modal-item' + (campfireCanAfford ? '' : ' disabled');
  const campfireCostText = Object.entries(CAMPFIRE_RECIPE.cost).map(([k, v]) => `${v} ${k}`).join(', ');
  campfireDiv.innerHTML = `
    <span class="item-icon">🔥</span>
    <span class="item-name">${CAMPFIRE_RECIPE.label}</span>
    <span class="item-cost">${campfireCostText}</span>
  `;
  campfireDiv.addEventListener('click', () => {
    if (!campfireCanAfford) return;
    activeBuildType = 'campfire';
    buildModal.classList.add('hidden');
    player.lock();
    survival.showToast('Selected Campfire — click in the world to place it.');
  });
  buildGrid.appendChild(campfireDiv);
}

function cancelBuildMode() {
  activeBuildType = null;
}

function tryPlaceBuilding() {
  if (!activeBuildType) return;

  const { position, yaw } = player.getBuildPlacement(5);

  if (activeBuildType === 'house') {
    if (!survival.canBuildHouse()) {
      survival.showToast('Not enough materials.');
      activeBuildType = null;
      return;
    }
    survival.buildHouse();
    world.placeHouse(position, yaw);
  } else if (activeBuildType === 'campfire') {
    if (!survival.canBuildCampfire()) {
      survival.showToast('Not enough materials.');
      activeBuildType = null;
      return;
    }
    survival.buildCampfire();
    world.placeCampfire(position, yaw);
  }

  activeBuildType = null;
}

// ---------- House modal (view / upgrade) ----------
let openHouseBuilding = null;

function openHouseModal(building) {
  openHouseBuilding = building;
  const tierInfo = HOUSE_TIERS[building.tier];
  houseModalTitle.textContent = building.free && building.tier === 1
    ? `${tierInfo.label} (Free Starter House)`
    : `${tierInfo.label} (Tier ${building.tier})`;

  const nextTier = HOUSE_TIERS[building.tier + 1];
  if (nextTier) {
    const costText = Object.entries(nextTier.cost).map(([k, v]) => `${v} ${k}`).join(', ');
    houseModalInfo.textContent = `Upgrade to ${nextTier.label}: ${costText}`;
    houseUpgradeBtn.textContent = `Upgrade to ${nextTier.label}`;
    houseUpgradeBtn.disabled = !survival.canUpgradeHouse(building.tier);
    houseUpgradeBtn.classList.remove('hidden');
  } else {
    houseModalInfo.textContent = 'This house is fully upgraded.';
    houseUpgradeBtn.classList.add('hidden');
  }

  houseModal.classList.remove('hidden');
  player.unlock();
}

houseUpgradeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
houseUpgradeBtn.addEventListener('click', () => {
  if (!openHouseBuilding) return;
  if (!survival.canUpgradeHouse(openHouseBuilding.tier)) return;

  if (survival.spendUpgrade(openHouseBuilding.tier)) {
    world.upgradeHouse(openHouseBuilding);
    openHouseModal(openHouseBuilding); // refresh modal with new tier info
  }
});

// NOTE: while pointer lock is active there is no free OS cursor, so plain
// 'click' events on on-screen HUD buttons never land reliably. We unlock
// pointer lock on 'mousedown' (which still fires while locked) before the
// click completes, so the button becomes clickable. Keyboard shortcuts
// are provided as a reliable backup for every action below.
function unlockBeforeClick(el, handler) {
  el.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    if (player.isLocked()) player.unlock();
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    handler();
  });
}

unlockBeforeClick(buildToggleBtn, () => toggleModal(buildModal, true));

// ---------- Eat / Drink prompts ----------
unlockBeforeClick(eatPromptBtn, () => { survival.eatFood(); player.lock(); });
unlockBeforeClick(drinkPromptBtn, () => { survival.drinkWater(); player.lock(); });

// ---------- Sleep ----------
function trySleep() {
  const isDaytime = world.isDaytime();
  if (!survival.canSleep(isDaytime)) return;

  survival.isSleeping = true;

  // Brief "sleeping" pause, then jump to morning (time fraction 0.28 = just past sunrise)
  setTimeout(() => {
    world.setTime(0.28);
    dayNumber++;
    lastIsDaytime = true;
    survival.isSleeping = false;
    survival.applySleepRecovery();
  }, 900);
}

unlockBeforeClick(sleepBtn, () => { trySleep(); player.lock(); });

// Keyboard fallback: F to sleep (when available)
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') trySleep();
});

// ---------- Controls tab ----------
const controlsTabToggle = document.getElementById('controls-tab-toggle');
const controlsTab = document.getElementById('controls-tab');
unlockBeforeClick(controlsTabToggle, () => {
  controlsTab.classList.toggle('hidden');
  player.lock();
});

// ---------- Mobile touch controls ----------
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const joystick = document.getElementById('touch-joystick');
const joystickKnob = document.getElementById('touch-joystick-knob');
const touchJump = document.getElementById('touch-jump');
const touchSprint = document.getElementById('touch-sprint');
const touchAction = document.getElementById('touch-action');
const touchInteract = document.getElementById('touch-interact');

if (isTouchDevice) {
  let joyActive = false;
  let joyStart = { x: 0, y: 0 };
  const joyRadius = 45;

  const setMove = (dx, dy) => {
    player.move.forward = dy < -0.3;
    player.move.backward = dy > 0.3;
    player.move.left = dx < -0.3;
    player.move.right = dx > 0.3;
  };

  joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joyActive = true;
    const t = e.touches[0];
    joyStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  joystick.addEventListener('touchmove', (e) => {
    if (!joyActive) return;
    e.preventDefault();
    const t = e.touches[0];
    let dx = t.clientX - joyStart.x;
    let dy = t.clientY - joyStart.y;
    const dist = Math.min(Math.hypot(dx, dy), joyRadius);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist;
    const ky = Math.sin(angle) * dist;
    joystickKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    setMove(kx / joyRadius, ky / joyRadius);
  }, { passive: false });

  const endJoystick = (e) => {
    e.preventDefault();
    joyActive = false;
    joystickKnob.style.transform = 'translate(0, 0)';
    setMove(0, 0);
  };
  joystick.addEventListener('touchend', endJoystick, { passive: false });
  joystick.addEventListener('touchcancel', endJoystick, { passive: false });

  touchJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (player.canJump) { player.velocity.y = player.jumpStrength; player.canJump = false; }
  }, { passive: false });

  touchSprint.addEventListener('touchstart', (e) => { e.preventDefault(); player.move.sprint = true; }, { passive: false });
  touchSprint.addEventListener('touchend', (e) => { e.preventDefault(); player.move.sprint = false; }, { passive: false });

  touchAction.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (activeBuildType) tryPlaceBuilding();
    else tryGather();
  }, { passive: false });

  touchInteract.addEventListener('touchstart', (e) => {
    e.preventDefault();
    tryInteractOrGather();
  }, { passive: false });

  // On touch devices, tapping the game area should lock/start play too
  renderer.domElement.addEventListener('touchstart', () => {
    if (!player.isLocked() && !survival.isDead) player.lock();
  }, { passive: true });
}

// ---------- Resize handling ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Main loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  const playerPos = player.getObject().position;

  if (!survival.isSleeping) {
    world.update(delta, playerPos);
  }

  const isDaytime = world.isDaytime();
  if (isDaytime && !lastIsDaytime) dayNumber++;
  lastIsDaytime = isDaytime;

  if (player.isLocked() && !survival.isDead && !survival.isSleeping) {
    const sprinting = player.update(delta, survival.canSprint());
    survival.update(delta, sprinting, isDaytime, dayNumber);
    updateInteractPrompt();
  }

  survival.updateTimeUI(world.time, world.getClockLabel(), isDaytime);

  renderer.render(scene, camera);
}

animate();
