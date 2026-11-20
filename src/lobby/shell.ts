export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="shell">
      <div class="world" id="world"></div><div class="grain"></div>
      <div class="brand"><div class="brand-mark">✦</div><div><div class="brand-name">Cloudline</div><div class="brand-sub">A CO-OP SPACE GAME</div></div></div>
      <section class="lobby-wrap" id="lobby-wrap">
        <div class="lobby-card" id="lobby-card">
          <div class="eyebrow">✦ Space crew, assemble</div>
          <h1>One ship.<br>Many pilots.</h1>
          <p class="intro">Take the controls together, thread glowing holes through an asteroid field, and be ready when the crew’s keys shuffle.</p>
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
          <div class="stats"><div class="stat"><div class="stat-label">Team score</div><div class="stat-value mint" id="hud-score">000</div></div><div class="stat"><div class="stat-label">Flight time</div><div class="stat-value" id="hud-time">00:00</div></div><div class="stat"><div class="stat-label">Holes cleared</div><div class="stat-value" id="hud-hoops">0</div></div></div>
          <div class="control-map" id="control-map" aria-label="Current controls"></div>
          <div class="hud-tools"><div class="room-pill" id="hud-room">ROOM ———</div><button class="sound-toggle" id="sound-toggle" type="button" aria-label="Mute sound" aria-pressed="true">SOUND ON</button></div>
        </div>
        <div class="seat-hud" id="seat-hud"></div>
        <div class="hud-right"><div class="speedometer"><div class="speed-number" id="hud-speed">210</div><div class="speed-unit">KM / H</div></div><div class="effect-tag hidden" id="hud-effect"></div></div>
        <div class="shuffle-alert hidden" id="shuffle-alert"></div>
        <button class="button secondary hidden" id="end-run-button" style="position:absolute;right:32px;top:84px;width:auto;padding:0 16px;margin:0;pointer-events:auto">End run</button><div class="footer-tip" id="footer-tip">W A S D · co-op keyboard · thread the holes, avoid the rocks</div>
      </section>
      <div class="overlay hidden" id="result-overlay"><div class="result-card"><div class="eyebrow" id="result-eyebrow">Run complete</div><h2 id="result-title">Nice flying, crew.</h2><div class="result-score" id="result-score">0</div><div class="result-copy">shared team points</div><div class="leaderboard" id="leaderboard"></div><div class="leaderboard" id="top-leaderboard"></div><button class="button" id="restart-button">Start a new run</button><button class="button secondary hidden" id="return-lobby-button">Return to lobby</button><button class="button secondary" id="leave-button">Leave room</button></div></div>
      <div class="toast hidden" id="toast"></div>
    </div>`;
}
