<script setup lang="ts">
const steps = [
  { number: '01', title: 'Declare', text: '把 Skills、Rules、MCP 和目标 Agent 写进一份 Manifest。' },
  { number: '02', title: 'Lock', text: '用内容哈希锁定来源，保证每台设备解析出相同环境。' },
  { number: '03', title: 'Reconcile', text: '设备上报状态，AgentX 生成修复计划并保留回滚点。' },
]
const features = [
  { label: 'LOCAL FIRST', title: '先让一台机器可靠', text: 'CLI 不依赖云端也能初始化、安装、比较和回滚。' },
  { label: 'TEAM CONTROL', title: '再把标准交给团队', text: 'Workspace Manifest、角色和审批策略，让共享环境可审计。' },
  { label: 'CONTENT HASHED', title: '每个版本都有证据', text: '不可变 Artifact、SHA-256 和可选签名，避免“看起来一样”。' },
]
</script>

<template>
  <div class="site-shell">
    <header class="topbar">
      <a class="brand" href="#top"><span class="brand-mark">AX</span><span>AgentX</span></a>
      <nav aria-label="主导航"><a href="#workflow">工作方式</a><a href="#features">能力</a><a href="#start">开始使用</a></nav>
      <a class="nav-cta" href="https://github.com/agentx-ai" target="_blank" rel="noreferrer">GitHub <span>↗</span></a>
    </header>

    <main id="top">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">DECLARATIVE CONTROL FOR AI AGENTS</p>
          <h1>把 Agent 环境，<em>交给一份 Manifest。</em></h1>
          <p class="hero-lede">AgentX 让 Skills、Rules、MCP、版本和团队策略有一个可复现的来源。换机器、扩团队、修 Drift，都从同一个事实开始。</p>
          <div class="hero-actions"><a class="button button-primary" href="#start">开始使用 <span>↓</span></a><a class="button button-quiet" href="https://github.com/agentx-ai/agentx-cli" target="_blank" rel="noreferrer">查看代码 <span>↗</span></a></div>
          <div class="hero-meta"><span><i class="status-dot"></i> Local-first</span><span>Codex · Claude Code</span><span>Open source</span></div>
        </div>
        <div class="control-plane" aria-label="AgentX 控制平面示意图">
          <div class="plane-header"><span class="live-dot"></span><span>workspace / platform</span><span class="revision">REV 014</span></div>
          <div class="plane-main">
            <div class="manifest-column"><div class="code-label">team-manifest.yaml</div><pre><span class="muted">version:</span> <b>1</b>
<span class="muted">packages:</span>
  - <span class="accent">review-skill</span> <small>1.2.3</small>
  - <span class="accent">release-mcp</span> <small>0.8.1</small>
<span class="muted">policy:</span>
  <span class="key">signed:</span> <b>true</b></pre></div>
            <div class="device-column">
              <div class="device-row"><span class="device-icon">⌘</span><div><b>laptop-01</b><small>in sync</small></div><strong>0</strong></div>
              <div class="device-row warning"><span class="device-icon">⌘</span><div><b>build-02</b><small>update ready</small></div><strong>2</strong></div>
              <div class="device-row"><span class="device-icon">⌘</span><div><b>desktop-03</b><small>in sync</small></div><strong>0</strong></div>
            </div>
          </div>
          <div class="plane-footer"><span>SHA-256 verified</span><span>heartbeat 18s ago</span><span class="footer-arrow">→</span></div>
        </div>
      </section>

      <section id="workflow" class="workflow section-band"><div class="section-intro"><p class="eyebrow">ONE SOURCE OF TRUTH</p><h2>从声明到设备，<br /><span>每一步都能解释。</span></h2></div><div class="step-grid"><article v-for="step in steps" :key="step.number" class="step"><span class="step-number">{{ step.number }}</span><h3>{{ step.title }}</h3><p>{{ step.text }}</p></article></div></section>
      <section id="features" class="features section-band"><div class="section-intro"><p class="eyebrow">WHY AGENTX</p><h2>不是同步文件。<br /><span>是管理环境的状态。</span></h2></div><div class="feature-list"><article v-for="feature in features" :key="feature.label" class="feature-row"><span class="feature-label">{{ feature.label }}</span><h3>{{ feature.title }}</h3><p>{{ feature.text }}</p><span class="row-arrow">↗</span></article></div></section>
      <section id="start" class="start section-band"><div><p class="eyebrow">START WITH THE CLI</p><h2>先在一台机器上，<br /><span>恢复你的 Agent 环境。</span></h2></div><div class="terminal"><div class="terminal-bar"><span></span><span></span><span></span><b>agentx</b></div><pre><span class="prompt">$</span> agentx init
<span class="prompt">$</span> agentx lock
<span class="prompt">$</span> agentx install --yes --frozen
<span class="success">✓ installed 4 skills for codex, claude</span>
<span class="success">✓ environment is reproducible</span></pre></div></section>
    </main>
    <footer><a class="brand" href="#top"><span class="brand-mark">AX</span><span>AgentX</span></a><span>Declarative environments for AI agents.</span><a href="https://github.com/agentx-ai" target="_blank" rel="noreferrer">Open source on GitHub ↗</a></footer>
  </div>
</template>
