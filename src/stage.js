/**
 * The stage.
 *
 * With the header removed the twin fills the window, so this is the mount point
 * the 3D viewer and BRUCE render into. The one piece of chrome it keeps is the
 * annotation switch: the pills are the whole UI, so there has to be a visible
 * way to clear them off the plant.
 */
export class Stage {
  constructor(root) {
    root.innerHTML = `
      <div class="shell">
        <main class="stage" id="stage">
          <label class="switch" title="Show or hide the area annotations">
            <input type="checkbox" class="switch__box" checked>
            <span class="switch__track"><span class="switch__knob"></span></span>
            <span class="switch__label">Annotations</span>
          </label>
        </main>
      </div>`;
    this.el = root.querySelector('#stage');
    this.box = this.el.querySelector('.switch__box');
  }

  get stageEl() { return this.el; }

  /** Report the switch, and keep it in step with changes made by the A key. */
  onAnnotations(cb) {
    this.box.addEventListener('change', () => cb(this.box.checked));
  }

  setAnnotations(on) { this.box.checked = on; }
}
