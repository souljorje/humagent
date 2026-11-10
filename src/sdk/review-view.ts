import { icon } from '../shared/icons.js';
import { inputStyles } from '../shared/input-styles.js';
import { materialStyles } from '../shared/material-styles.js';
import { installTooltips } from '../shared/tooltips.js';

export function createReviewView() {
  const host = document.createElement('div');
  host.dataset.humagentUi = '';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:14px/1.45 system-ui,sans-serif;color:#f5f5f5;color-scheme:dark}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button,textarea{font:inherit;color:inherit} button{border:0;cursor:pointer;background:transparent;min-height:40px;padding:8px 12px;border-radius:20px;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background 140ms,transform 140ms}
    button:not(.glass-surface):hover{background:#ffffff14}button:active{transform:scale(.96)}button:disabled{opacity:.42;cursor:default;transform:none}
    button:focus-visible,textarea:focus-visible{outline:2px solid #f5f5f5;outline-offset:3px}
    #panel{position:fixed;z-index:2;pointer-events:auto;border-radius:22px;padding:8px;max-height:calc(100dvh - 24px);overflow:auto;scrollbar-color:#888 transparent;transition:opacity 160ms,transform 160ms cubic-bezier(.16,1,.3,1),display 160ms allow-discrete;width:min(360px,calc(100vw - 24px))}
    #panel[hidden]{opacity:0;transform:translateY(5px);pointer-events:none}
    @starting-style{#panel:not([hidden]){opacity:0;transform:translateY(5px)}}
    #editor{margin:0}.compose{display:flex;align-items:center;gap:8px}
    ${materialStyles}
    ${inputStyles}
    ::selection{background:#666;color:#fff}.primary{background:#ffffffeb;box-shadow:inset 0 1px 0 #ffffff80;color:#222;flex-shrink:0}.primary:hover{background:#fff}.icon{width:40px;padding:0}
    #actions{display:flex;align-items:center;gap:6px;margin-top:8px}#actions>.tooltip-anchor:has(#remove){margin-right:auto}#actions>.tooltip-anchor:has(#cancel){margin-left:auto}#save{min-width:64px}
    #local-error,#editor-status{font-size:12px;margin:6px 10px;color:#ddd}
    .marker{position:fixed;pointer-events:auto;width:32px;min-height:32px;padding:0;border-radius:16px 16px 16px 5px;color:#fff;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;z-index:1;transition:background 140ms}
    .marker::before{content:'';position:absolute;inset:-6px}.marker:hover,.marker[aria-expanded=true],.marker.highlighted,.marker:focus-visible{--glass-fill:rgb(54 54 58 / 88%)}
    #highlight{position:fixed;outline:2px solid #1685ff;outline-offset:-1px;background:#1685ff0a;pointer-events:none}
    #keyboard-hint{position:fixed;left:12px;top:12px;padding:8px 12px;border-radius:12px;background:#252525;color:#ddd;font-size:12px}
    @media(prefers-reduced-motion:reduce){*,*::before{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  </style>
  <div id="highlight" hidden></div><div id="markers"></div>
  <p id="keyboard-hint" hidden role="status">Arrow keys choose an element. Enter comments. Escape exits.</p>
  <section id="panel" class="glass-surface" role="dialog" aria-label="Feedback" hidden>
    <form id="editor">
      <div class="compose"><textarea id="note" class="feedback-input" aria-label="Comment" placeholder="Add a comment…" rows="1" maxlength="4000"></textarea><button class="primary icon" id="confirm" aria-label="Add comment" type="submit">${icon('check')}</button></div>
      <p id="editor-status" role="status" hidden></p><p id="local-error" role="alert" hidden></p>
      <div id="actions" hidden><button id="remove" class="icon" aria-label="Delete comment" type="button">${icon('trash')}</button><button id="cancel" type="button">Cancel</button><button class="primary" id="save" type="submit">Save</button></div>
    </form>
  </section>`;
  (document.body || document.documentElement).append(host);
  installTooltips(shadow);
  type Controls = Record<string, HTMLElement> & {
    editor: HTMLFormElement;
    note: HTMLTextAreaElement;
    confirm: HTMLButtonElement;
    save: HTMLButtonElement;
    remove: HTMLButtonElement;
  };
  const $ = <K extends keyof Controls>(id: K): Controls[K] =>
    shadow.getElementById(id) as Controls[K];
  return { host, shadow, $ };
}
