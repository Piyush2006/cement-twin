/**
 * The stage.
 *
 * With the header removed the twin fills the window, so this is simply the mount
 * point the 3D viewer and BRUCE render into. It owns no chrome of its own.
 */
export class Stage {
  constructor(root) {
    root.innerHTML = '<div class="shell"><main class="stage" id="stage"></main></div>';
    this.el = root.querySelector('#stage');
  }

  get stageEl() { return this.el; }
}
