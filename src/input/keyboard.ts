import { maskFromCodes } from '../sim/bindings';

export class KeyboardState {
  private held = new Set<string>();
  private attached = false;
  private down = (event: KeyboardEvent) => {
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    event.preventDefault(); this.held.add(event.code);
  };
  private up = (event: KeyboardEvent) => { this.held.delete(event.code); };
  private blur = () => this.held.clear();
  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur);
    this.attached = true;
  }
  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur);
    this.attached = false; this.held.clear();
  }
  get mask(): number { return maskFromCodes(this.held); }
  get isDown(): boolean { return this.held.size > 0; }
}
