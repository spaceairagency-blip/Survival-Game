/**
 * Survival module
 * ---------------
 * Manages player stats (health, hunger, thirst, stamina), a real inventory,
 * eat/drink prompts, the house system (build + upgrade), campfire cooking,
 * sleep, and drives all related HUD updates. Framework-agnostic (no
 * Three.js needed).
 */

// Items that can be eaten/drunk directly from inventory, and their effect
const CONSUMABLES = {
  berry: { restores: 'hunger', amount: 18, label: 'Berries' },
  cookedMeat: { restores: 'hunger', amount: 35, label: 'Cooked Meat' },
  water: { restores: 'thirst', amount: 30, label: 'Water' },
};

// House tiers: cost to build tier 1, then cost to upgrade to each next tier
export const HOUSE_TIERS = {
  1: { label: 'Basic Hut', cost: { wood: 40, stone: 10 }, description: 'A simple shelter for the night.' },
  2: { label: 'Wooden House', cost: { wood: 35, stone: 15 }, description: 'Adds a proper wooden floor.' },
  3: { label: 'Reinforced House', cost: { wood: 30, stone: 40 }, description: 'Stone-trimmed and sturdier.' },
};

export const CAMPFIRE_RECIPE = {
  label: 'Campfire',
  cost: { wood: 10, stone: 5 },
  description: 'Cook raw meat into food here.',
};

const TIPS = [
  "Press E to gather resources when you see 'Press E to interact'.",
  "Sprint drains stamina fast — let it recover before sprinting again.",
  "Berries and cooked meat restore hunger. Water restores thirst.",
  "You can only sleep at night — find a safe spot first.",
  "Hunt chickens for raw meat, then cook it at a campfire.",
  "Low health regenerates slowly if your hunger and thirst are both above 50%.",
  "Running out of hunger or thirst will start draining your health.",
  "Open your inventory to eat or drink directly from your stockpile.",
  "A basic hut needs 40 wood and 10 stone to build.",
  "You can upgrade your house at its location for a stronger tier.",
  "Night drains hunger a little faster — stock up before dark.",
  "Sleeping skips straight to morning and restores some stamina.",
  "Keep an eye on the tip badge — it updates with helpful reminders.",
];

export class SurvivalSystem {
  constructor(onDeath) {
    this.stats = {
      health: 100,
      hunger: 100,
      thirst: 100,
      stamina: 100,
    };

    this.inventory = {
      wood: 0,
      stone: 0,
      berry: 0,
      water: 0,
      rawMeat: 0,
      cookedMeat: 0,
    };

    this.onDeath = onDeath;
    this.isDead = false;
    this.elapsedTime = 0;
    this.isSleeping = false;

    this._tipIndex = -1;
    this._tipTimer = 0;
    this._tipInterval = 9; // seconds between auto tip rotation

    this._cacheDom();
    this._nextTip(true);
  }

  _cacheDom() {
    this.dom = {
      health: document.getElementById('health-bar'),
      hunger: document.getElementById('hunger-bar'),
      thirst: document.getElementById('thirst-bar'),
      stamina: document.getElementById('stamina-bar'),
      countWood: document.getElementById('count-wood'),
      countStone: document.getElementById('count-stone'),
      countBerry: document.getElementById('count-berry'),
      countWater: document.getElementById('count-water'),
      countRawMeat: document.getElementById('count-rawMeat'),
      countCookedMeat: document.getElementById('count-cookedMeat'),
      toastContainer: document.getElementById('toast-container'),
      daytimeIcon: document.getElementById('daytime-icon'),
      daytimeText: document.getElementById('daytime-text'),
      timeClock: document.getElementById('time-clock'),
      timeBarFill: document.getElementById('time-bar-fill'),
      eatPrompt: document.getElementById('eat-prompt'),
      drinkPrompt: document.getElementById('drink-prompt'),
      tipText: document.getElementById('tip-text'),
      sleepBtn: document.getElementById('sleep-btn'),
    };
  }

  // ---------- Inventory ----------

  addItem(type, amount) {
    if (this.inventory[type] === undefined) return;
    this.inventory[type] += amount;
    this.updateInventoryUI();
  }

  hasEnough(cost) {
    return Object.entries(cost).every(([item, amt]) => (this.inventory[item] || 0) >= amt);
  }

  spendItems(cost) {
    if (!this.hasEnough(cost)) return false;
    for (const [item, amt] of Object.entries(cost)) {
      this.inventory[item] -= amt;
    }
    this.updateInventoryUI();
    return true;
  }

  /** Eat/drink a specific consumable from inventory (used by prompts or manual click) */
  consume(type) {
    const c = CONSUMABLES[type];
    if (!c) return false;
    if ((this.inventory[type] || 0) <= 0) return false;

    this.inventory[type] -= 1;
    this.stats[c.restores] = Math.min(100, this.stats[c.restores] + c.amount);
    this.updateInventoryUI();
    this.showToast(`Consumed ${c.label} (+${c.amount} ${c.restores})`);
    return true;
  }

  /** Cook one raw meat into cooked meat (called when player interacts with a campfire) */
  cookMeat() {
    if (this.inventory.rawMeat <= 0) return false;
    this.inventory.rawMeat -= 1;
    this.inventory.cookedMeat += 1;
    this.updateInventoryUI();
    this.showToast('Cooked Raw Meat into Cooked Meat!');
    return true;
  }

  // ---------- House system ----------

  canBuildHouse() {
    return this.hasEnough(HOUSE_TIERS[1].cost);
  }

  buildHouse() {
    if (!this.spendItems(HOUSE_TIERS[1].cost)) {
      this.showToast('Not enough materials for a house.');
      return false;
    }
    this.showToast(`Built ${HOUSE_TIERS[1].label}!`);
    return true;
  }

  canUpgradeHouse(currentTier) {
    const nextTier = HOUSE_TIERS[currentTier + 1];
    if (!nextTier) return false;
    return this.hasEnough(nextTier.cost);
  }

  upgradeHouseCost(currentTier) {
    const nextTier = HOUSE_TIERS[currentTier + 1];
    return nextTier ? nextTier.cost : null;
  }

  spendUpgrade(currentTier) {
    const nextTier = HOUSE_TIERS[currentTier + 1];
    if (!nextTier) return false;
    if (!this.spendItems(nextTier.cost)) {
      this.showToast('Not enough materials to upgrade.');
      return false;
    }
    this.showToast(`Upgraded to ${nextTier.label}!`);
    return true;
  }

  // ---------- Campfire ----------

  canBuildCampfire() {
    return this.hasEnough(CAMPFIRE_RECIPE.cost);
  }

  buildCampfire() {
    if (!this.spendItems(CAMPFIRE_RECIPE.cost)) {
      this.showToast('Not enough materials for a campfire.');
      return false;
    }
    this.showToast(`Built ${CAMPFIRE_RECIPE.label}!`);
    return true;
  }

  // ---------- Core update loop ----------

  update(delta, isSprinting, isDaytime, dayNumber) {
    if (this.isDead || this.isSleeping) return;

    this.elapsedTime += delta;

    // Passive decay
    this.stats.hunger = Math.max(0, this.stats.hunger - delta * 0.4);
    this.stats.thirst = Math.max(0, this.stats.thirst - delta * 0.6);

    // Stamina drain/regen
    if (isSprinting) {
      this.stats.stamina = Math.max(0, this.stats.stamina - delta * 15);
    } else {
      this.stats.stamina = Math.min(100, this.stats.stamina + delta * 10);
    }

    // Health effects from starvation/dehydration
    if (this.stats.hunger <= 0 || this.stats.thirst <= 0) {
      this.stats.health = Math.max(0, this.stats.health - delta * 3);
    } else if (this.stats.hunger > 50 && this.stats.thirst > 50) {
      this.stats.health = Math.min(100, this.stats.health + delta * 0.5);
    }

    // Night is more dangerous
    if (!isDaytime) {
      this.stats.hunger = Math.max(0, this.stats.hunger - delta * 0.15);
    }

    if (this.stats.health <= 0 && !this.isDead) {
      this.isDead = true;
      this.onDeath();
    }

    this._updateEatDrinkPrompts();
    this._updateTips(delta);
    this.updateBarsUI();
    this.updateDaytimeUI(isDaytime, dayNumber);
  }

  canSprint() {
    return this.stats.stamina > 5;
  }

  // ---------- Eat / Drink contextual prompts ----------

  _updateEatDrinkPrompts() {
    const needsFood = this.stats.hunger < 40;
    const needsWater = this.stats.thirst < 40;

    const hasFood = this.inventory.berry > 0 || this.inventory.cookedMeat > 0;
    const hasWater = this.inventory.water > 0;

    if (needsFood && hasFood) {
      this.dom.eatPrompt.classList.remove('hidden');
    } else {
      this.dom.eatPrompt.classList.add('hidden');
    }

    if (needsWater && hasWater) {
      this.dom.drinkPrompt.classList.remove('hidden');
    } else {
      this.dom.drinkPrompt.classList.add('hidden');
    }
  }

  /** Called when player clicks the "Eat Food" prompt/button */
  eatFood() {
    if (this.inventory.cookedMeat > 0) return this.consume('cookedMeat');
    if (this.inventory.berry > 0) return this.consume('berry');
    return false;
  }

  /** Called when player clicks the "Drink Water" prompt/button */
  drinkWater() {
    return this.consume('water');
  }

  // ---------- Sleep ----------

  canSleep(isDaytime) {
    return !isDaytime && !this.isSleeping && !this.isDead;
  }

  /** Sleep restores some stamina/health and is handled by main.js advancing time to morning */
  applySleepRecovery() {
    this.stats.stamina = 100;
    this.stats.health = Math.min(100, this.stats.health + 15);
    this.showToast('You slept through the night.');
  }

  // ---------- Tips ----------

  _updateTips(delta) {
    this._tipTimer += delta;
    if (this._tipTimer >= this._tipInterval) {
      this._tipTimer = 0;
      this._nextTip();
    }
  }

  _nextTip() {
    let contextualTip = null;

    // Prioritize contextual, situation-aware tips over the rotation
    if (this.stats.hunger < 25 && this.inventory.berry === 0 && this.inventory.cookedMeat === 0) {
      contextualTip = "You're low on food and have none stored — find a berry bush or hunt a chicken!";
    } else if (this.stats.thirst < 25 && this.inventory.water === 0) {
      contextualTip = "You're low on water and have none stored — find a pond!";
    } else if (this.inventory.rawMeat > 0) {
      contextualTip = 'You have raw meat — cook it at a campfire before eating it.';
    } else if (this.canBuildHouse()) {
      contextualTip = 'You have enough materials to build a house!';
    } else if (this.stats.stamina < 15) {
      contextualTip = 'Stamina is low — stop sprinting and let it recover.';
    }

    if (contextualTip) {
      this.dom.tipText.textContent = contextualTip;
      return;
    }

    this._tipIndex = (this._tipIndex + 1) % TIPS.length;
    this.dom.tipText.textContent = TIPS[this._tipIndex];
  }

  // ---------- UI ----------

  updateBarsUI() {
    this.dom.health.style.width = `${this.stats.health}%`;
    this.dom.hunger.style.width = `${this.stats.hunger}%`;
    this.dom.thirst.style.width = `${this.stats.thirst}%`;
    this.dom.stamina.style.width = `${this.stats.stamina}%`;
  }

  updateInventoryUI() {
    this.dom.countWood.textContent = this.inventory.wood;
    this.dom.countStone.textContent = this.inventory.stone;
    this.dom.countBerry.textContent = this.inventory.berry;
    this.dom.countWater.textContent = this.inventory.water;
    if (this.dom.countRawMeat) this.dom.countRawMeat.textContent = this.inventory.rawMeat;
    this.dom.countCookedMeat.textContent = this.inventory.cookedMeat;
  }

  updateDaytimeUI(isDaytime, dayNumber) {
    this.dom.daytimeIcon.textContent = isDaytime ? '☀️' : '🌙';
    this.dom.daytimeText.textContent = `Day ${dayNumber}`;
  }

  /** timeFraction: 0-1 across the full day/night cycle. clockLabel: "HH:MM" string */
  updateTimeUI(timeFraction, clockLabel, isDaytime) {
    this.dom.timeClock.textContent = clockLabel;
    this.dom.timeBarFill.style.width = `${timeFraction * 100}%`;
    this.dom.timeBarFill.style.background = isDaytime
      ? 'linear-gradient(90deg, #ffd76f, #fff2c4)'
      : 'linear-gradient(90deg, #35468f, #7d8fd6)';

    if (this.dom.sleepBtn) {
      this.dom.sleepBtn.classList.toggle('hidden', !this.canSleep(isDaytime));
    }
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  reset() {
    this.stats = { health: 100, hunger: 100, thirst: 100, stamina: 100 };
    this.inventory = { wood: 0, stone: 0, berry: 0, water: 0, rawMeat: 0, cookedMeat: 0 };
    this.isDead = false;
    this.isSleeping = false;
    this.elapsedTime = 0;
    this.updateBarsUI();
    this.updateInventoryUI();
    this._nextTip(true);
  }

  formatTime() {
    const mins = Math.floor(this.elapsedTime / 60);
    const secs = Math.floor(this.elapsedTime % 60);
    return `${mins}m ${secs}s`;
  }
}
