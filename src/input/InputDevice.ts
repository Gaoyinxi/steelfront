/**
 * Raw browser input (keyboard, mouse, pointer lock). Holds device state only;
 * translating it into game intent is the job of PlayerInputSystem.
 */
export class InputDevice {
  private readonly keys = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private readonly buttons = new Set<number>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) {
        void target.requestPointerLock();
        return;
      }
      this.buttons.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    });
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.buttons.clear();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only during the first frame after the key went down. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  isButtonDown(button: number): boolean {
    return this.buttons.has(button);
  }

  /** Returns and clears accumulated mouse movement since the last call. */
  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const r = { dx: this.mouseDx, dy: this.mouseDy, wheel: this.wheel };
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
    return r;
  }

  /** Call at the end of each rendered frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
