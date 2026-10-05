<script setup lang="ts">
// phone / laptop ⇄ (private network) ⇄ wherdr ⇄ Herdr ⇄ agents.
// Plain HTML boxes and 1 px links with packets gliding along them (CSS only).
const agents = [
  { name: 'Claude Code', color: 'var(--claude)' },
  { name: 'Codex', color: 'var(--codex)' },
  { name: 'omp', color: 'var(--omp)' },
  { name: '+ any Herdr agent', color: 'var(--dim)' },
]
</script>

<template>
  <div class="flow" role="img" aria-label="Your phone or laptop reaches wherdr through your private network (Tailscale). wherdr runs next to Herdr on your server and talks to its local socket; Herdr runs your coding agents.">
    <div class="node devices">
      <span class="label"><span class="k">01</span> You</span>
      <div class="title">Phone &amp; laptop</div>
      <ul><li>PWA · push</li><li>any browser</li></ul>
    </div>
    <div class="link net">
      <span class="tag">tailnet · HTTPS</span>
      <i class="pkt" /><i class="pkt rev" />
    </div>
    <div class="node wherdr fx-ring halo">
      <span class="label"><span class="k">02</span> wherdr</span>
      <div class="title">wherdr</div>
      <ul><li>Nitro · 127.0.0.1:7683</li><li>passkey lock</li></ul>
    </div>
    <div class="link">
      <span class="tag">unix socket</span>
      <i class="pkt" /><i class="pkt rev" />
    </div>
    <div class="node">
      <span class="label"><span class="k">03</span> Herdr</span>
      <div class="title">Herdr</div>
      <ul><li>spaces · tabs · panes</li><li>SSH machines</li></ul>
    </div>
    <div class="link">
      <span class="tag">PTY</span>
      <i class="pkt" /><i class="pkt rev" />
    </div>
    <div class="node agents">
      <span class="label"><span class="k">04</span> Agents</span>
      <ul class="ag">
        <li v-for="a in agents" :key="a.name"><span class="sq" :style="{ background: a.color }" />{{ a.name }}</li>
      </ul>
    </div>
    <div class="zone" aria-hidden="true"><span class="label">your server · your private network · no cloud</span></div>
  </div>
</template>

<style scoped>
.flow {
  position: relative; display: grid; align-items: stretch;
  grid-template-columns: 1fr minmax(60px, .7fr) 1fr minmax(60px, .55fr) 1fr minmax(48px, .45fr) 1.1fr;
  padding: 56px 28px 28px; border: 1px solid var(--line); background: var(--bg-2);
}
.zone { position: absolute; top: 18px; left: calc(28px + (100% - 56px) * .27); right: 28px; height: calc(100% - 36px); border: 1px dashed var(--line-strong); pointer-events: none; }
.zone .label { position: absolute; top: -9px; left: 16px; padding: 0 8px; background: var(--bg-2); font-size: 10px; color: var(--dim); }
.node { position: relative; z-index: 1; display: grid; align-content: start; gap: 8px; padding: 16px; border: 1px solid var(--line-strong); background: var(--surface); }
.node.wherdr { --fx-fill: var(--surface); }
.node .label { font-size: 10px; }
.title { font-family: var(--display); font-weight: 800; font-size: 20px; color: #fff; letter-spacing: -0.02em; }
ul { margin: 0; padding: 0; list-style: none; font: 12px/1.7 var(--mono); color: var(--muted); }
.ag li { display: flex; align-items: center; gap: 8px; color: var(--text); }
.sq { width: 8px; height: 8px; flex: none; }
.link { position: relative; align-self: center; height: 1px; background: var(--line-strong); }
.link .tag { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); white-space: nowrap; font: 10px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.net { background: repeating-linear-gradient(90deg, var(--accent) 0 6px, transparent 6px 10px); opacity: .9; }
.pkt { position: absolute; top: -2px; left: 0; width: 6px; height: 5px; background: var(--accent); box-shadow: 0 0 10px var(--accent); animation: go 2.6s linear infinite; }
.pkt.rev { background: var(--violet); box-shadow: 0 0 10px var(--violet); animation-direction: reverse; animation-delay: -1.3s; }
@keyframes go { from { left: 0; } to { left: calc(100% - 6px); } }
@media (max-width: 960px) {
  .flow { grid-template-columns: 1fr; padding: 48px 20px 20px; }
  .zone { display: none; }
  .link { justify-self: center; width: 1px; height: 56px; }
  .net { background: repeating-linear-gradient(180deg, var(--accent) 0 6px, transparent 6px 10px); }
  .link .tag { bottom: auto; top: 50%; left: 14px; transform: translateY(-50%); }
  .pkt { left: -2px; top: 0; width: 5px; height: 6px; animation-name: down; }
  @keyframes down { from { top: 0; } to { top: calc(100% - 6px); } }
}
</style>
