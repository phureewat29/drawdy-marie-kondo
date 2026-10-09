/** The panel's static markup and styles. Colours come from Drawdy's theme vars. */

import { ICONS } from "../shared/icons.ts";

export const PANEL_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
    font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--drawdy-background, #fff);
    color: var(--drawdy-foreground, #111);
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
}
button { font: inherit; color: inherit; }
.icon { width: 16px; height: 16px; flex: none; }
.muted { color: var(--drawdy-muted-foreground, #777); }
.small { font-size: 11px; }
[hidden] { display: none !important; }

/* Only while something is happening: getting ready, a task, a failure. */
#status { padding: 8px 14px 4px; border-top: 1px solid var(--drawdy-border, #e5e5e5); }
.status-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
#status-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; max-width: 100%; }
#status-detail { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#progress { height: 3px; margin: 6px 0 4px; border-radius: 2px; background: var(--drawdy-border, #e5e5e5); overflow: hidden; }
#progress-bar { height: 100%; width: 0; background: var(--drawdy-primary, #6366f1); transition: width .2s; }
/* Progress with no measure (loading from this device): a moving bar. */
.indeterminate > div { width: 30% !important; animation: sweep 1.2s ease-in-out infinite; }
@keyframes sweep { from { transform: translateX(-100%) } to { transform: translateX(340%) } }

#boot { padding: 16px 14px; }
#work { display: flex; flex-direction: column; flex: 1; min-height: 0; }
#setup { padding: 22px 18px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
#setup .mark { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--drawdy-surface2, rgba(0,0,0,.05)); color: #b69cff; }
#setup .mark .icon { width: 20px; height: 20px; }
#setup h2 { margin: 4px 0 0; font-size: 15px; font-weight: 600; }
#setup p { margin: 0; }
#setup-progress { height: 6px; border-radius: 3px; background: var(--drawdy-border, #e5e5e5); overflow: hidden; }
#setup-bar { height: 100%; width: 0; background: var(--drawdy-primary, #6366f1); transition: width .2s; }
#setup .action { width: 100%; height: 38px; margin-top: 4px; }
#setup-notice:empty { display: none; }
code {
    font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere;
    padding: 1px 5px; border-radius: 4px; background: var(--drawdy-surface2, rgba(0,0,0,.06));
}


.search { padding: 12px 14px 8px; position: relative; }
.search > .icon { position: absolute; left: 26px; top: 22px; color: var(--drawdy-muted-foreground, #888); pointer-events: none; }
#query {
    width: 100%; height: 36px; padding: 6px 12px 6px 34px; font-size: 14px;
    color: var(--drawdy-foreground, #111); background: var(--drawdy-surface, #fff);
    border: 1px solid var(--drawdy-border, #e5e5e5); border-radius: var(--drawdy-radius-lg, 12px); outline: none;
}
#query:focus-visible { box-shadow: 0 0 0 2px var(--drawdy-background, #fff), 0 0 0 4px var(--drawdy-ring, #6366f1); }
#query::placeholder { color: var(--drawdy-muted-foreground, #888); }

main { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.hint { padding: 10px 6px; }
.stale { opacity: .5; transition: opacity .15s; }
.hint b { color: var(--drawdy-foreground, #111); font-weight: 600; }
.examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chip {
    border: 1px solid var(--drawdy-border, #e5e5e5); background: var(--drawdy-surface, #fff);
    border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.chip:hover { border-color: var(--drawdy-primary, #6366f1); }

.hit {
    display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px;
    border: 0; border-radius: var(--drawdy-radius-md, 8px); background: transparent; text-align: left; cursor: pointer;
}
.hit:hover, .hit:focus-visible { background: var(--drawdy-surface2, rgba(0,0,0,.05)); outline: none; }
.hit .kind { width: 22px; flex: none; display: flex; justify-content: center; color: var(--drawdy-muted-foreground, #888); }
.hit .label { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.hit .score { flex: none; width: 46px; }
.hit .copies { flex: none; font-variant-numeric: tabular-nums; }
.bar { height: 4px; border-radius: 2px; background: var(--drawdy-border, #e5e5e5); overflow: hidden; margin-top: 3px; }
.bar > i { display: block; height: 100%; background: var(--drawdy-primary, #6366f1); }
.pct { font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }

/* Groups: one bar, collapsed by default, to step through or open. */
#clusters { padding: 4px 8px; border-top: 1px solid var(--drawdy-border, #e5e5e5); }
.groups-bar { display: flex; align-items: center; gap: 2px; }
.groups-toggle {
    flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px;
    border: 0; background: none; border-radius: 6px; cursor: pointer; font-weight: 600; text-align: left;
}
.groups-toggle > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.groups-toggle .icon { width: 14px; height: 14px; color: var(--drawdy-muted-foreground, #777); transition: transform .15s; }
.groups-toggle[aria-expanded="true"] .icon { transform: rotate(90deg); }
.nav { width: 28px; height: 28px; display: grid; place-items: center; border: 0; background: none; border-radius: 6px; cursor: pointer; }
.nav .icon { width: 15px; height: 15px; }
.groups-toggle:hover, .nav:hover:not(:disabled) { background: var(--drawdy-surface2, rgba(0,0,0,.05)); }
.nav:disabled { opacity: .35; cursor: default; }
#group-pos { min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }
#groups-list { max-height: 180px; overflow-y: auto; padding-bottom: 2px; }
.group { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px; border: 0; background: none; cursor: pointer; border-radius: 6px; text-align: left; }
.group:hover { background: var(--drawdy-surface2, rgba(0,0,0,.05)); }
.group[aria-current="true"] { background: var(--drawdy-surface2, rgba(0,0,0,.07)); font-weight: 600; }
.group .index { width: 16px; flex: none; text-align: right; font-variant-numeric: tabular-nums; }
.group .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group .count { flex: none; }

#notice { margin: 0 14px 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px; background: var(--drawdy-surface2, rgba(0,0,0,.05)); }
#notice.error { color: var(--drawdy-destructive, #ef4444); }
#notice.success { color: var(--drawdy-success, #16a34a); }

footer { padding: 10px 14px 12px; border-top: 1px solid var(--drawdy-border, #e5e5e5); display: grid; grid-template-columns: 1fr auto auto; gap: 8px; }
footer .wide { grid-column: 1 / -1; }
.action {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
    height: 34px; padding: 0 10px; border-radius: var(--drawdy-radius-md, 8px); font-weight: 600; cursor: pointer;
    border: 1px solid var(--drawdy-border, #e5e5e5); background: var(--drawdy-surface, #fff);
}
/* Labels stay on one line; a narrow panel trims them rather than wrapping. */
.action { min-width: 0; }
.action > span { overflow: hidden; text-overflow: ellipsis; }
.action.primary { background: var(--drawdy-primary, #6366f1); color: var(--drawdy-primary-foreground, #fff); border-color: transparent; }
/* Once the board has content, sample notes are a quiet text button. */
.action.quiet { border-color: transparent; background: none; color: var(--drawdy-muted-foreground, #777); font-weight: 500; height: 28px; }
.action.quiet:not(:disabled):hover { color: var(--drawdy-foreground, #111); filter: none; }
.action:disabled { opacity: .45; cursor: default; }
.action:not(:disabled):hover { filter: brightness(1.06); }
#groups {
    height: 34px; border-radius: var(--drawdy-radius-md, 8px); padding: 0 6px; font: inherit;
    color: var(--drawdy-foreground, #111); background: var(--drawdy-surface, #fff); border: 1px solid var(--drawdy-border, #e5e5e5);
}
#stats { grid-column: 1 / -1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#credit { grid-column: 1 / -1; margin: -4px 0 0; text-align: center; font-size: 10px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;

export const PANEL_BODY = `
<div id="boot" class="muted small">Starting…</div>
<section id="setup" hidden>
    <div class="mark">${ICONS.sparkles}</div>
    <h2 id="setup-title" aria-live="polite"></h2>
    <p id="setup-text"></p>
    <p class="small"><code id="setup-model"></code></p>
    <div id="setup-progress" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" hidden><div id="setup-bar"></div></div>
    <p id="setup-detail" class="muted small"></p>
    <p id="setup-file-line" class="muted small" hidden><code id="setup-file"></code></p>
    <button class="action primary" id="setup-download">${ICONS.download}<span id="setup-label"></span></button>
    <p id="setup-note" class="muted small"></p>
    <p id="setup-notice" class="muted small" role="status"></p>
</section>
<div id="work" hidden>
<div class="search">
    ${ICONS.search}
    <input id="query" type="search" placeholder="Search by meaning, in any language…" autocomplete="off" spellcheck="false" />
</div>
<main id="results"></main>
<section id="clusters" hidden>
    <div class="groups-bar">
        <button class="groups-toggle" id="groups-toggle" aria-expanded="false" aria-controls="groups-list">${ICONS.chevronRight}<span id="groups-title"></span></button>
        <button class="nav" id="group-prev" title="Previous group" aria-label="Previous group">${ICONS.chevronLeft}</button>
        <span id="group-pos" class="muted small"></span>
        <button class="nav" id="group-next" title="Next group" aria-label="Next group">${ICONS.chevronRight}</button>
    </div>
    <div id="groups-list" hidden></div>
</section>
<div id="status" hidden>
    <div class="status-line"><span id="status-title" aria-live="polite"></span><span id="status-detail" class="muted small"></span></div>
    <div id="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="100" hidden><div id="progress-bar"></div></div>
</div>
<div id="notice" role="status" aria-live="polite" hidden></div>
<footer>
    <button class="action primary" id="cluster" title="Sort the selected notes into groups by meaning">${ICONS.group}<span>Group</span></button>
    <select id="groups" title="How many groups" aria-label="How many groups">
        <option value="">Auto</option>
        <option value="3">3</option><option value="4">4</option><option value="5">5</option>
        <option value="6">6</option><option value="8">8</option>
    </select>
    <button class="action" id="similar" title="Select every note that says the same thing">${ICONS.similar}<span>Find similar</span></button>
    <button class="action wide" id="demo">${ICONS.sample}<span>Try with sample notes</span></button>
    <div id="stats" class="muted small"></div>
    <p id="credit" class="muted">Engine: EmbeddingGemma 2</p>
</footer>
</div>
`;
