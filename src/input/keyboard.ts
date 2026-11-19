import { KeyCode, KEY_BITS, InputBitmask } from "../sim/types";

const VALID_KEY_CODES: KeyCode[] = ["KeyW", "KeyA", "KeyS", "KeyD"];

export class KeyboardTracker {
  private keyState = new Map<KeyCode, boolean>();
  private seq = 0;
  private onChange?: (bits: InputBitmask, seq: number) => void;

  constructor(onChange?: (bits: InputBitmask, seq: number) => void) {
    this.onChange = onChange;
    for (const code of VALID_KEY_CODES) {
      this.keyState.set(code, false);
    }

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const code = e.code as KeyCode;
    if (VALID_KEY_CODES.includes(code)) {
      if (!this.keyState.get(code)) {
        this.keyState.set(code, true);
        this.emitChange();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const code = e.code as KeyCode;
    if (VALID_KEY_CODES.includes(code)) {
      if (this.keyState.get(code)) {
        this.keyState.set(code, false);
        this.emitChange();
      }
    }
  };

  public getBits(): InputBitmask {
    let bits = 0;
    for (const code of VALID_KEY_CODES) {
      if (this.keyState.get(code)) {
        bits |= KEY_BITS[code];
      }
    }
    return bits;
  }

  public getNextSeq(): number {
    return ++this.seq;
  }

  private emitChange(): void {
    if (this.onChange) {
      this.onChange(this.getBits(), this.getNextSeq());
    }
  }

  public reset(): void {
    for (const code of VALID_KEY_CODES) {
      this.keyState.set(code, false);
    }
  }

  public destroy(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }
}
