// hud.js — целият интерфейс е обикновен DOM върху камерата, през
// dom-overlay. Никакви текстури с текст, никакъв WebGL шрифт.

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = {
      score: root.querySelector('#score'),
      combo: root.querySelector('#combo'),
      wave: root.querySelector('#wave'),
      health: root.querySelector('#health-fill'),
      heat: root.querySelector('#heat-fill'),
      status: root.querySelector('#status'),
      toast: root.querySelector('#toast'),
      panel: root.querySelector('#panel'),
      panelTitle: root.querySelector('#panel-title'),
      panelBody: root.querySelector('#panel-body'),
      caps: root.querySelector('#caps'),
      crosshair: root.querySelector('#crosshair')
    };
    this.toastTimer = null;
  }

  setCaps(caps) {
    if (caps.label) { this.el.caps.textContent = caps.label; return; }
    const line = [
      caps.anchors ? 'котви' : null,
      caps.planes ? 'равнини' : null,
      caps.depth ? 'дълбочина' : null,
      caps.light ? 'светлина' : null
    ].filter(Boolean);
    this.el.caps.textContent = line.length ? line.join(' · ') : 'базов AR режим';
  }

  status(text) {
    this.el.status.textContent = text || '';
    this.el.status.style.display = text ? 'block' : 'none';
  }

  toast(text, ms = 1100) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.remove('show');
    }, ms);
  }

  update(game) {
    this.el.score.textContent = game.score;
    this.el.wave.textContent = `вълна ${game.wave}`;
    const mult = game.multiplier;
    this.el.combo.textContent = mult > 1 ? `×${mult.toFixed(1)}` : '';
    this.el.combo.classList.toggle('hot', mult >= 2.5);
    this.el.health.style.width = `${Math.max(0, game.health)}%`;
    this.el.health.classList.toggle('low', game.health <= 30);
    this.el.heat.style.width = `${Math.min(100, game.heat * 100)}%`;
    this.el.heat.classList.toggle('over', game.overheatFor > 0);
    this.el.crosshair.classList.toggle('locked', game.overheatFor > 0);
  }

  showPanel(title, html) {
    this.el.panelTitle.textContent = title;
    this.el.panelBody.innerHTML = html;
    this.el.panel.classList.add('show');
  }

  hidePanel() {
    this.el.panel.classList.remove('show');
  }

  flash(kind) {
    this.root.classList.remove('flash-hit', 'flash-hurt', 'flash-bad');
    // рестарт на анимацията
    void this.root.offsetWidth;
    if (kind) this.root.classList.add(`flash-${kind}`);
  }
}
