import { useEffect, useRef, type MutableRefObject } from 'react';

export type InputKeyAction =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'jump'
  | 'dodge'
  | 'attack'
  | 'special'
  | 'skill1'
  | 'skill2'
  | 'skill3'
  | 'skill4'
  | 'ultimate'
  | 'lockEnemy'
  | 'clearTarget'
  | 'toggleHelp'
  | 'toggleDebug'
  | 'pause'
  | 'interact';

export interface BufferedAction {
  action: InputKeyAction;
  timestamp: number; // performance.now()
}

export interface DebugInputState {
  activeKeys: string[];
  lastKeyCode: string;
  lastSkillAttempted: string;
  lastSkillResult: string;
  fps: number;
}

export interface GameInputSnapshot {
  actions: Record<InputKeyAction, boolean>;
  justPressed: Record<InputKeyAction, boolean>;
  buffer: BufferedAction[];
  debug: DebugInputState;
  addBuffer: (action: InputKeyAction) => void;
  consumeBuffer: () => InputKeyAction | null;
  peekBuffer: () => InputKeyAction | null;
}

export const createEmptyActions = (): Record<InputKeyAction, boolean> => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  dodge: false,
  attack: false,
  special: false,
  skill1: false,
  skill2: false,
  skill3: false,
  skill4: false,
  ultimate: false,
  lockEnemy: false,
  clearTarget: false,
  toggleHelp: false,
  toggleDebug: false,
  pause: false,
  interact: false,
});

const bufferMs = () => ((globalThis as any).__TQ_BUFFER_MS as number) || 150;

export function useGameInput(options: {
  enabled?: boolean;
  onToggleDebug?: () => void;
  onToggleHelp?: () => void;
  onEscape?: () => void;
} = {}): MutableRefObject<GameInputSnapshot> {
  const { enabled = true, onToggleDebug, onToggleHelp, onEscape } = options;

  const inputRef = useRef<GameInputSnapshot>({
    actions: createEmptyActions(),
    justPressed: createEmptyActions(),
    buffer: [],
    debug: {
      activeKeys: [],
      lastKeyCode: 'None',
      lastSkillAttempted: 'None',
      lastSkillResult: 'Ready',
      fps: 60,
    },
    addBuffer: () => {},
    consumeBuffer: () => null,
    peekBuffer: () => null,
  });

  // Attach buffer methods
  inputRef.current.addBuffer = (action: InputKeyAction) => {
    const now = performance.now();
    // Keep only unexpired buffer elements (< 150ms)
    inputRef.current.buffer = inputRef.current.buffer.filter((b) => now - b.timestamp <= bufferMs());
    inputRef.current.buffer.push({ action, timestamp: now });
  };

  inputRef.current.consumeBuffer = (): InputKeyAction | null => {
    const now = performance.now();
    // Drop expired
    while (inputRef.current.buffer.length > 0 && now - inputRef.current.buffer[0].timestamp > bufferMs()) {
      inputRef.current.buffer.shift();
    }
    if (inputRef.current.buffer.length > 0) {
      const item = inputRef.current.buffer.shift()!;
      return item.action;
    }
    return null;
  };

  inputRef.current.peekBuffer = (): InputKeyAction | null => {
    const now = performance.now();
    while (inputRef.current.buffer.length > 0 && now - inputRef.current.buffer[0].timestamp > bufferMs()) {
      inputRef.current.buffer.shift();
    }
    return inputRef.current.buffer.length > 0 ? inputRef.current.buffer[0].action : null;
  };

  useEffect(() => {
    if (!enabled) return;

    const pressedKeyCodes = new Set<string>();
    let frameCount = 0;
    let lastFpsTime = performance.now();

    const updateDebugKeys = (code = '') => {
      inputRef.current.debug.activeKeys = Array.from(pressedKeyCodes);
      if (code) {
        inputRef.current.debug.lastKeyCode = code;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // typing in a text box (nickname, room code) is not game input
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      const code = e.code || '';
      pressedKeyCodes.add(code);
      updateDebugKeys(code);

      // F3 Debug Overlay
      if (code === 'F3') {
        e.preventDefault();
        inputRef.current.justPressed.toggleDebug = true;
        onToggleDebug?.();
        return;
      }

      // H Key Controls Help
      if (code === 'KeyH') {
        e.preventDefault();
        inputRef.current.justPressed.toggleHelp = true;
        onToggleHelp?.();
        return;
      }

      // Escape Menu
      if (code === 'Escape') {
        e.preventDefault();
        inputRef.current.justPressed.pause = true;
        onEscape?.();
        return;
      }

      // Tab Enemy Target Lock
      if (code === 'Tab') {
        e.preventDefault();
        inputRef.current.actions.lockEnemy = true;
        inputRef.current.justPressed.lockEnemy = true;
        return;
      }

      // WASD / Arrow Keys Movement
      if (code === 'KeyW' || code === 'ArrowUp') {
        inputRef.current.actions.forward = true;
      }
      if (code === 'KeyS' || code === 'ArrowDown') {
        inputRef.current.actions.backward = true;
      }
      if (code === 'KeyA' || code === 'ArrowLeft') {
        inputRef.current.actions.left = true;
      }
      if (code === 'KeyD' || code === 'ArrowRight') {
        inputRef.current.actions.right = true;
      }

      // F: hold to climb a ladder (青冥古林)
      if (code === 'KeyF') inputRef.current.actions.interact = true;

      // Jump (Space)
      if (code === 'Space') {
        e.preventDefault();
        if (!inputRef.current.actions.jump) {
          inputRef.current.justPressed.jump = true;
          inputRef.current.addBuffer('jump');
        }
        inputRef.current.actions.jump = true;
      }

      // Dodge Roll (ShiftLeft or ShiftRight)
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        e.preventDefault();
        if (!inputRef.current.actions.dodge) {
          inputRef.current.justPressed.dodge = true;
          inputRef.current.addBuffer('dodge');
        }
        inputRef.current.actions.dodge = true;
      }

      // Skills 1-4 & Ultimate (R) & Extra keys (Q, E)
      if (code === 'Digit1') {
        inputRef.current.actions.skill1 = true;
        inputRef.current.justPressed.skill1 = true;
        inputRef.current.addBuffer('skill1');
      }
      if (code === 'Digit2') {
        inputRef.current.actions.skill2 = true;
        inputRef.current.justPressed.skill2 = true;
        inputRef.current.addBuffer('skill2');
      }
      if (code === 'Digit3') {
        inputRef.current.actions.skill3 = true;
        inputRef.current.justPressed.skill3 = true;
        inputRef.current.addBuffer('skill3');
      }
      if (code === 'Digit4') {
        inputRef.current.actions.skill4 = true;
        inputRef.current.justPressed.skill4 = true;
        inputRef.current.addBuffer('skill4');
      }
      if (code === 'KeyR') {
        inputRef.current.actions.ultimate = true;
        inputRef.current.justPressed.ultimate = true;
        inputRef.current.addBuffer('ultimate');
      }
      if (code === 'KeyQ') {
        // Alt hotkey for Skill 1
        inputRef.current.actions.skill1 = true;
        inputRef.current.justPressed.skill1 = true;
        inputRef.current.addBuffer('skill1');
      }
      if (code === 'KeyE') {
        // Alt hotkey for Skill 2
        inputRef.current.actions.skill2 = true;
        inputRef.current.justPressed.skill2 = true;
        inputRef.current.addBuffer('skill2');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const code = e.code || '';
      pressedKeyCodes.delete(code);
      updateDebugKeys();

      if (code === 'KeyW' || code === 'ArrowUp') {
        inputRef.current.actions.forward = false;
      }
      if (code === 'KeyS' || code === 'ArrowDown') {
        inputRef.current.actions.backward = false;
      }
      if (code === 'KeyA' || code === 'ArrowLeft') {
        inputRef.current.actions.left = false;
      }
      if (code === 'KeyD' || code === 'ArrowRight') {
        inputRef.current.actions.right = false;
      }
      if (code === 'Space') {
        inputRef.current.actions.jump = false;
      }
      if (code === 'KeyF') inputRef.current.actions.interact = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        inputRef.current.actions.dodge = false;
      }
      if (code === 'Digit1' || code === 'KeyQ') {
        inputRef.current.actions.skill1 = false;
      }
      if (code === 'Digit2' || code === 'KeyE') {
        inputRef.current.actions.skill2 = false;
      }
      if (code === 'Digit3') {
        inputRef.current.actions.skill3 = false;
      }
      if (code === 'Digit4') {
        inputRef.current.actions.skill4 = false;
      }
      if (code === 'KeyR') {
        inputRef.current.actions.ultimate = false;
      }
      if (code === 'Tab') {
        inputRef.current.actions.lockEnemy = false;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        if (!inputRef.current.actions.attack) {
          inputRef.current.justPressed.attack = true;
          inputRef.current.addBuffer('attack');
        }
        inputRef.current.actions.attack = true;
        inputRef.current.debug.lastKeyCode = 'Mouse0 (LMB)';
      } else if (e.button === 2) {
        if (!inputRef.current.actions.special) {
          inputRef.current.justPressed.special = true;
          inputRef.current.addBuffer('special');
        }
        inputRef.current.actions.special = true;
        inputRef.current.debug.lastKeyCode = 'Mouse2 (RMB)';
      } else if (e.button === 1) {
        e.preventDefault();
        inputRef.current.justPressed.clearTarget = true;
        inputRef.current.actions.clearTarget = true;
        inputRef.current.debug.lastKeyCode = 'Mouse1 (MMB)';
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        inputRef.current.actions.attack = false;
      } else if (e.button === 2) {
        inputRef.current.actions.special = false;
      } else if (e.button === 1) {
        inputRef.current.actions.clearTarget = false;
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleBlur = () => {
      pressedKeyCodes.clear();
      inputRef.current.actions = createEmptyActions();
      inputRef.current.justPressed = createEmptyActions();
      inputRef.current.debug.activeKeys = [];
    };

    let animId: number;
    const updateFps = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastFpsTime >= 500) {
        inputRef.current.debug.fps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        frameCount = 0;
        lastFpsTime = now;
      }
      animId = requestAnimationFrame(updateFps);
    };
    animId = requestAnimationFrame(updateFps);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('blur', handleBlur);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('blur', handleBlur);
    };
  }, [enabled, onToggleDebug, onToggleHelp, onEscape]);

  return inputRef;
}
