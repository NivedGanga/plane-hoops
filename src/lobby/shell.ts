export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="shell">
      <div class="world" id="world"></div><div class="grain"></div>
      <div class="brand"><div class="brand-mark">✦</div><div><div class="brand-name">Cloudline</div><div class="brand-sub">A CO-OP SPACE GAME</div></div></div>
      <section class="lobby-wrap" id="lobby-wrap">
        <div class="lobby-card" id="lobby-card">
          <div class="eyebrow">✦ Space crew, assemble</div>
          <h1>One ship.<br>Many pilots.</h1>
          <p class="intro">Take the controls together, steer through the winding open corridor in a solid asteroid field, and be ready when the crew’s keys shuffle.</p>
          <div class="tabs"><button class="active" data-tab="create">Create a room</button><button data-tab="join">Join a crew</button></div>
          <div id="create-form">
            <label class="field-label" for="room-name-input">Room / team name (1–24 characters)</label><input class="field" id="room-name-input" maxlength="24" autocomplete="organization" />
            <label class="field-label" for="host-name-input">Your display name (1–16 characters)</label><input class="field" id="host-name-input" maxlength="16" autocomplete="name" />
            <label class="field-label">Choose your crew size</label>
            <div class="option-row"><button class="choice selected" data-count="2"><strong>2 pilots</strong><small>Fast &amp; nimble</small></button><button class="choice" data-count="4"><strong>4 pilots</strong><small>Full flight deck</small></button></div>
            <label class="field-label" for="local-seats">Seats on this keyboard</label>
            <select class="select" id="local-seats"><option value="1">1 local pilot · others join online</option><option value="2">2 local pilots · shared keyboard</option></select>
            <div id="local-seat-names"></div>
            <button class="button" id="create-room">Create flight room</button>
            <div class="helper">Your browser hosts the run. Invite the rest of the crew with a six-character room code.</div>
          </div>
          <div id="join-form" class="hidden">
            <label class="field-label" for="join-name-input">Your display name (1–16 characters)</label><input class="field" id="join-name-input" maxlength="16" autocomplete="name" />
            <label class="field-label" for="room-code-input">Six-character room code</label>
            <input class="field" id="room-code-input" maxlength="6" placeholder="e.g. CLOUD" autocomplete="off" />
            <button class="button" id="join-room">Join the flight</button>
            <div class="helper">There are no seats to watch from the sidelines — joining reserves a pilot seat.</div>
          </div>
          <div id="room-view" class="hidden"></div>
          <div class="error hidden" id="error-message"></div>
        </div>
      </section>
      <section class="game-hud hidden" id="game-hud">
        <div class="hud-top">
          <div class="hud-panel gate-panel" aria-label="Gate progress">
            <span class="gate-emblem" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2 22 12 12 22 2 12Z"/><path d="M12 7 17 12 12 17 7 12Z"/></svg></span>
            <span class="hud-label">Gates:</span><strong class="gate-value" id="hud-gates">0 / 8</strong>
          </div>
          <div class="control-map" id="control-map" aria-label="Current key-to-direction mapping"></div>
          <div class="hud-panel timer-panel" aria-label="Flight time">
            <span class="timer-emblem" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 5V3M12 13l3-2M18 7l1.5-1.5"/></svg></span>
            <span class="hud-label">Time:</span><strong class="timer-value" id="hud-time">00:00.00</strong>
          </div>
        </div>
        <div class="hud-bottom-left">
          <div class="room-pill" id="hud-room">ROOM ———</div>
          <button class="sound-toggle" id="sound-toggle" type="button" aria-label="Mute sound" aria-pressed="true">SOUND ON</button>
          <button class="end-run-button hidden" id="end-run-button" type="button">End run</button>
        </div>
        <div class="effect-tag hidden" id="hud-effect"></div>
        <div class="speedometer" aria-label="Current speed"><span class="speed-label">Speed:</span><strong class="speed-number" id="hud-speed">210</strong><span class="speed-unit">KM/H</span></div>
        <div class="shuffle-alert hidden" id="shuffle-alert"></div>
      </section>
      <div class="overlay hidden" id="result-overlay"><div class="result-card"><div class="eyebrow" id="result-eyebrow">Run complete</div><h2 id="result-title">Nice flying, crew.</h2><div class="result-score" id="result-score">0</div><div class="result-copy">shared team points</div><div class="leaderboard" id="leaderboard"></div><div class="leaderboard" id="top-leaderboard"></div><button class="button" id="restart-button">Start a new run</button><button class="button secondary hidden" id="return-lobby-button">Return to lobby</button><button class="button secondary" id="leave-button">Leave room</button></div></div>
      <div class="toast hidden" id="toast"></div>
    </div>`;
}
