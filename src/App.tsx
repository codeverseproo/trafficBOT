import { useState, useEffect, useRef } from 'react';
import { Play, LayoutDashboard, Globe, Shield, Activity, Users, Save, Plus, Trash, Square, PauseCircle, PlayCircle, FileText } from 'lucide-react';
import './index.css';

interface LogEntry { level: 'info' | 'warn' | 'error'; msg: string; ts: number; }

declare global {
  interface Window {
    api: {
      store: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        delete: (key: string) => Promise<void>;
      };
      engine: {
        runProject: (options: any) => Promise<{ success: boolean; error?: string }>;
        stop:   () => Promise<{ ok: boolean }>;
        pause:  () => Promise<{ ok: boolean }>;
        resume: () => Promise<{ ok: boolean }>;
      };
      onLog: (cb: (log: LogEntry) => void) => () => void;
    };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused,  setIsPaused]  = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // Project State
  const [urls, setUrls] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [runMode, setRunMode] = useState<'headless' | 'headed' | 'mixed'>('headless');
  const [headless, setHeadless] = useState(true); // Keep for legacy compat
  const [useProxyPool, setUseProxyPool] = useState(false);
  const [manualAssistMode, setManualAssistMode] = useState(false);
  const [sessionWarm, setSessionWarm] = useState(false);
  const [searchReferer, setSearchReferer] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState<string>('');
  const [totalSessions, setTotalSessions] = useState(1);
  const [burnProxyAfterUse, setBurnProxyAfterUse] = useState(false);
  const [postReadDelay, setPostReadDelay] = useState(5);
  const [minSessionSeconds, setMinSessionSeconds] = useState(30);
  const [proxyRotation, setProxyRotation] = useState('smart');
  // Persona State
  const [personas, setPersonas] = useState<any[]>([]);
  const [newPersonaName, setNewPersonaName] = useState('');
  
  // Proxy State
  const [proxies, setProxies] = useState<any[]>([]);
  const [bulkProxyText, setBulkProxyText] = useState('');

  // User Agent State
  const [uas, setUAs] = useState<string[]>([]);
  const [bulkUAText, setBulkUAText] = useState('');

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedUrls = await window.api.store.get('project_urls');
        if (savedUrls) setUrls(savedUrls);
        const savedConcurrency = await window.api.store.get('project_concurrency');
        if (savedConcurrency) setConcurrency(savedConcurrency);
        const savedHeadless = await window.api.store.get('project_headless');
        if (savedHeadless !== undefined) setHeadless(savedHeadless);
        setPersonas(await window.api.store.get('personas') || []);
        setProxies(await window.api.store.get('proxies') || []);
        setUAs(await window.api.store.get('userAgents') || []);
      } catch {}
    };
    loadState();

    // Live log listener
    const cleanup = window.api.onLog((entry: LogEntry) => {
      setLogs(prev => [...prev.slice(-400), entry]); // keep last 400 lines
    });
    return cleanup;
  }, []);

  // Auto-scroll log panel
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const saveProject = async () => {
    await window.api.store.set('project_urls', urls);
    await window.api.store.set('project_concurrency', concurrency);
    await window.api.store.set('project_headless', headless);
    alert('Project saved locally!');
  };

  const startRun = async () => {
    if (!urls.trim()) return alert('Please enter at least one URL');
    setIsRunning(true);
    setIsPaused(false);
    setLogs([]);
    const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean)
      .map(u => u.startsWith('http') ? u : `https://${u}`);
    try {
      const result = await window.api.engine.runProject({
        urls: urlList, headless, concurrency, useProxyPool,
        manualAssistMode, sessionWarm, searchReferer, burnProxyAfterUse,
        totalSessions, postReadDelay, minSessionSeconds, proxyRotation,
        runMode, personaId: selectedPersona || undefined
      });
      if (!result.success) alert('Run failed: ' + result.error);
    } catch { alert('Failed to start run'); }
    finally {
      setIsRunning(false);
      setIsPaused(false);
      setProxies(await window.api.store.get('proxies') || []);
    }
  };

  const stopRun = async () => {
    await window.api.engine.stop();
    setIsRunning(false);
    setIsPaused(false);
  };

  const togglePause = async () => {
    if (isPaused) {
      await window.api.engine.resume();
      setIsPaused(false);
    } else {
      await window.api.engine.pause();
      setIsPaused(true);
    }
  };

  const addPersona = async () => {
    if (!newPersonaName) return;
    const newPersona = {
      id: Date.now().toString(),
      name: newPersonaName,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      viewport: { width: 1280, height: 720 },
    };
    const updated = [...personas, newPersona];
    setPersonas(updated);
    await window.api.store.set('personas', updated);
    setNewPersonaName('');
  };

  const deletePersona = async (id: string) => {
    const updated = personas.filter(p => p.id !== id);
    setPersonas(updated);
    await window.api.store.set('personas', updated);
    if (selectedPersona === id) setSelectedPersona('');
  };



  const bulkImportProxies = async () => {
    if (!bulkProxyText.trim()) return;
    const lines = bulkProxyText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = [];
    
    for (const line of lines) {
      if (line.includes('://')) {
        try {
          const url = new URL(line);
          parsed.push({
            id: Date.now().toString() + Math.random().toString(),
            server: `${url.protocol}//${url.hostname}:${url.port}`,
            username: url.username ? decodeURIComponent(url.username) : undefined,
            password: url.password ? decodeURIComponent(url.password) : undefined,
            healthScore: 100, failures: 0
          });
        } catch {}
      } else {
        const parts = line.split(':');
        if (parts.length >= 2) {
          parsed.push({
            id: Date.now().toString() + Math.random().toString(),
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2] || undefined,
            password: parts[3] || undefined,
            healthScore: 100, failures: 0
          });
        }
      }
    }
    
    const updated = [...proxies, ...parsed];
    setProxies(updated);
    await window.api.store.set('proxies', updated);
    setBulkProxyText('');
    alert(`Imported ${parsed.length} proxies!`);
  };

  const deleteProxy = async (id: string) => {
    const updated = proxies.filter(p => p.id !== id);
    setProxies(updated);
    await window.api.store.set('proxies', updated);
  };

  const clearAllProxies = async () => {
    if (!confirm('Are you sure you want to remove ALL proxies?')) return;
    setProxies([]);
    await window.api.store.set('proxies', []);
  };

  const clearAllPersonas = async () => {
    if (!confirm('Are you sure you want to remove ALL personas?')) return;
    setPersonas([]);
    await window.api.store.set('personas', []);
  };

  const bulkImportUAs = async () => {
    if (!bulkUAText.trim()) return;
    const lines = bulkUAText.split('\n').map(l => l.trim()).filter(Boolean);
    const updated = [...uas, ...lines];
    setUAs(updated);
    await window.api.store.set('userAgents', updated);
    setBulkUAText('');
    alert(`Imported ${lines.length} User Agents!`);
  };

  const clearUAs = async () => {
    setUAs([]);
    await window.api.store.set('userAgents', []);
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar glass-panel" style={{ borderRadius: 0, borderTop: 0, borderBottom: 0, borderLeft: 0 }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Globe color="white" size={20} />
          </div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', background: 'linear-gradient(to right, #fff, #A1A1AA)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PhantomControl
          </h2>
        </div>
        
        <nav style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '12px' }}>
          {[
            { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
            { id: 'projects', icon: Globe, label: 'Projects & URLs' },
            { id: 'proxies', icon: Shield, label: 'Proxy Pool' },
            { id: 'personas', icon: Users, label: 'Personas' },
            { id: 'logs', icon: FileText, label: 'Live Logs' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                borderRadius: '8px', background: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                transition: 'all 0.2s'
              }}
            >
              <tab.icon size={18} color={activeTab === tab.id ? 'var(--accent-primary)' : 'currentColor'} />
              <span style={{ fontWeight: 500 }}>{tab.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', padding: '24px' }}>
          <div className="card" style={{ padding: '16px', background: 'rgba(139, 92, 246, 0.05)', borderColor: 'var(--accent-glow)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>System Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isRunning ? 'var(--warning)' : 'var(--success)', boxShadow: `0 0 10px ${isRunning ? 'var(--warning)' : 'var(--success)'}` }} />
              <span style={{ fontSize: '14px', fontWeight: 500 }}>
                {isRunning ? 'Workers Active' : 'Workers Idle'}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header glass-panel" style={{ borderRadius: 0, borderTop: 0, borderRight: 0, borderLeft: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 600 }}>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
          </div>
        </header>

        <div className="content-area">
          {activeTab === 'dashboard' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
                <div className="card glass-panel">
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>Active Projects</div>
                  <div className="metric-value">1</div>
                </div>
                <div className="card glass-panel">
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>Configured Proxies</div>
                  <div className="metric-value">{proxies.length}</div>
                </div>
                <div className="card glass-panel">
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>Saved Personas</div>
                  <div className="metric-value">{personas.length}</div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === 'projects' && (
            <div className="card glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3>URL List Runner</h3>
                  <p style={{ color: 'var(--text-secondary)' }}>Configure and start batch URL executions.</p>
                </div>
                <button className="btn btn-secondary" onClick={saveProject}>
                  <Save size={16} /> Save Settings
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Target URLs (One per line)</label>
                  <textarea 
                    className="glass-panel"
                    style={{ width: '100%', height: '150px', background: 'var(--bg-primary)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)', padding: '12px', borderRadius: '8px', resize: 'vertical' }}
                    placeholder="https://example.com"
                    value={urls}
                    onChange={(e) => setUrls(e.target.value)}
                  />
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Run Mode</label>
                    <select 
                      className="glass-panel" 
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={runMode}
                      onChange={(e) => setRunMode(e.target.value as any)}
                      disabled={manualAssistMode}
                    >
                      <option value="headless">Headless (Fast & Invisible)</option>
                      <option value="headed">Headed (Debug / Monitor UI)</option>
                      <option value="mixed">Mixed (Half Headless, Half Headed)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Concurrency (Workers)</label>
                    <input 
                      type="number" 
                      min={1} 
                      max={10} 
                      className="glass-panel" 
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={concurrency}
                      onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
                    />
                  </div>
                  
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Persona</label>
                    <select 
                      className="glass-panel" 
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={selectedPersona}
                      onChange={(e) => setSelectedPersona(e.target.value)}
                    >
                      <option value="">(None - Fresh Session)</option>
                      {personas.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.timezoneId})</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Proxy Rotation Mode</label>
                    <select 
                      className="glass-panel" 
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={proxyRotation}
                      onChange={(e) => setProxyRotation(e.target.value)}
                    >
                      <option value="smart">Smart (Residential, Healthy, Least Used)</option>
                      <option value="round-robin">Round Robin</option>
                      <option value="random">Random</option>
                      <option value="sticky">Sticky (Keep proxy for same domain)</option>
                    </select>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', justifyContent: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={useProxyPool} onChange={(e) => setUseProxyPool(e.target.checked)} />
                      Use Proxy Pool (Rotate on Worker spawn)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={sessionWarm} onChange={(e) => setSessionWarm(e.target.checked)} />
                      Session Warming (Visit benign sites before target)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={searchReferer} onChange={(e) => setSearchReferer(e.target.checked)} />
                      Google Referrer (Simulate arriving via search)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={manualAssistMode} onChange={(e) => {
                        setManualAssistMode(e.target.checked);
                        if (e.target.checked) setHeadless(false);
                      }} />
                      Manual Assist Mode (Pause 30s for captcha solving)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={burnProxyAfterUse} onChange={(e) => setBurnProxyAfterUse(e.target.checked)} />
                      Burn Proxy After Use (One-time use)
                    </label>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Total Sessions (Views)</label>
                    <input 
                      type="number" 
                      className="glass-panel"
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={totalSessions}
                      onChange={(e) => setTotalSessions(parseInt(e.target.value) || 1)}
                      min="1"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Post-Visit Delay (Seconds)</label>
                    <input 
                      type="number" 
                      className="glass-panel"
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={postReadDelay}
                      onChange={(e) => setPostReadDelay(parseInt(e.target.value) || 0)}
                      min="0"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Min Session Duration (Secs)</label>
                    <input 
                      type="number" 
                      className="glass-panel"
                      style={{ width: '100%', padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                      value={minSessionSeconds}
                      onChange={(e) => setMinSessionSeconds(parseInt(e.target.value) || 30)}
                      min="10"
                    />
                  </div>
                </div>
                
                <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className={`btn ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={startRun}
                    disabled={isRunning}
                    style={{ minWidth: 160 }}
                  >
                    {isRunning ? <><Activity size={16} style={{ animation: 'spin 1s linear infinite' }}/> Running...</> : <><Play size={16}/> Start Run</>}
                  </button>

                  {isRunning && (
                    <button
                      className="btn btn-secondary"
                      onClick={togglePause}
                      style={{ minWidth: 120, borderColor: isPaused ? 'var(--success)' : 'var(--warning)', color: isPaused ? 'var(--success)' : 'var(--warning)' }}
                    >
                      {isPaused ? <><PlayCircle size={16}/> Resume</> : <><PauseCircle size={16}/> Pause</>}
                    </button>
                  )}

                  {isRunning && (
                    <button
                      className="btn btn-secondary"
                      onClick={stopRun}
                      style={{ minWidth: 100, borderColor: 'var(--error)', color: 'var(--error)' }}
                    >
                      <Square size={16}/> Stop
                    </button>
                  )}

                  {isRunning && (
                    <button className="btn btn-secondary" onClick={() => setActiveTab('logs')} style={{ fontSize: '13px' }}>
                      <FileText size={15}/> View Logs
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personas' && (
            <div className="card glass-panel">
              <h3>Persona Management</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Persistent profiles with cookies, localStorage, and consistent browser fingerprints.</p>
              
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <input 
                  type="text"
                  placeholder="E.g. US Desktop Chrome"
                  className="glass-panel"
                  style={{ flex: 1, padding: '10px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-focus)', borderRadius: '8px' }}
                  value={newPersonaName}
                  onChange={(e) => setNewPersonaName(e.target.value)}
                />
                <button className="btn btn-primary" onClick={addPersona}><Plus size={16} /> Add Persona</button>
                <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={clearAllPersonas}><Trash size={16} /> Clear All</button>
              </div>

              <div style={{ display: 'grid', gap: '12px', marginBottom: '40px' }}>
                {personas.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{p.locale} &bull; {p.timezoneId}</div>
                    </div>
                    <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={() => deletePersona(p.id)}><Trash size={16} /></button>
                  </div>
                ))}
              </div>

              <hr style={{ borderColor: 'var(--border-subtle)', margin: '20px 0' }} />

              <h3>User Agent Pool (Randomized)</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>When no Persona is selected, workers will randomly pick a User-Agent from this pool.</p>
              
              <div style={{ marginBottom: '16px' }}>
                <textarea 
                  className="glass-panel"
                  style={{ width: '100%', height: '100px', background: 'var(--bg-primary)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)', padding: '12px', borderRadius: '8px', resize: 'vertical' }}
                  placeholder="Paste User-Agents here (One per line)"
                  value={bulkUAText}
                  onChange={(e) => setBulkUAText(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button className="btn btn-primary" onClick={bulkImportUAs}><Save size={16} /> Bulk Import UAs</button>
                <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={clearUAs}><Trash size={16} /> Clear All ({uas.length})</button>
              </div>
            </div>
          )}

          {activeTab === 'proxies' && (
            <div className="card glass-panel">
              <h3>Proxy Pool</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>Proxies are rotated based on health scores. Failed requests reduce health, pushing the proxy to the bottom.</p>
              <div style={{ padding: '12px 16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#f59e0b', lineHeight: '1.5' }}>
                ⚠️ <strong>Chromium Limitation:</strong> SOCKS5 proxies with credentials are not supported — credentials will be stripped. Use <strong>HTTP/HTTPS</strong> proxies for authenticated access.
              </div>

              <div style={{ marginBottom: '16px' }}>
                <textarea 
                  className="glass-panel"
                  style={{ width: '100%', height: '100px', background: 'var(--bg-primary)', border: '1px solid var(--border-focus)', color: 'var(--text-primary)', padding: '12px', borderRadius: '8px', resize: 'vertical' }}
                  placeholder="Paste proxies here (One per line)&#10;Supported formats:&#10;ip:port:user:pass&#10;http://user:pass@ip:port"
                  value={bulkProxyText}
                  onChange={(e) => setBulkProxyText(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                <button className="btn btn-primary" onClick={bulkImportProxies}><Save size={16} /> Bulk Import Proxies</button>
                <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={clearAllProxies}><Trash size={16} /> Clear All ({proxies.length})</button>
              </div>

              <div style={{ display: 'grid', gap: '12px' }}>
                {proxies.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 500, fontFamily: 'monospace' }}>{p.server}</span>
                        {p.server.toLowerCase().startsWith('socks5') && p.username && (
                          <span style={{ fontSize: '10px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '4px', padding: '1px 6px' }}>SOCKS5 — auth stripped</span>
                        )}
                        {p.server.toLowerCase().startsWith('socks5') && !p.username && (
                          <span style={{ fontSize: '10px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '4px', padding: '1px 6px' }}>SOCKS5</span>
                        )}
                        {(p.server.toLowerCase().startsWith('http')) && p.username && (
                          <span style={{ fontSize: '10px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '4px', padding: '1px 6px' }}>HTTP+Auth ✓</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '12px' }}>
                        <span style={{ color: p.healthScore > 50 ? 'var(--success)' : 'var(--error)' }}>Health: {p.healthScore}%</span>
                        <span>Failures: {p.failures}</span>
                        {p.username && <span>User: {p.username}</span>}
                      </div>
                    </div>
                    <button className="btn btn-secondary" style={{ color: 'var(--error)' }} onClick={() => deleteProxy(p.id)}><Trash size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="card glass-panel" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0 }}>Live Logs</h3>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: '13px' }}>{logs.length} entries — auto-scrolling</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {isRunning && (
                    <button className="btn btn-secondary" onClick={togglePause}
                      style={{ borderColor: isPaused ? 'var(--success)' : 'var(--warning)', color: isPaused ? 'var(--success)' : 'var(--warning)' }}>
                      {isPaused ? <><PlayCircle size={15}/> Resume</> : <><PauseCircle size={15}/> Pause</>}
                    </button>
                  )}
                  {isRunning && (
                    <button className="btn btn-secondary" onClick={stopRun} style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
                      <Square size={15}/> Stop
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={() => setLogs([])} style={{ fontSize: '13px' }}>
                    <Trash size={15}/> Clear
                  </button>
                </div>
              </div>

              <div style={{
                flex: 1, overflowY: 'auto', background: '#0A0A0D', borderRadius: '10px',
                border: '1px solid var(--border-subtle)', padding: '14px', fontFamily: 'monospace',
                fontSize: '12.5px', lineHeight: '1.7',
              }}>
                {logs.length === 0 && (
                  <div style={{ color: 'var(--text-secondary)', textAlign: 'center', paddingTop: '40px' }}>
                    No logs yet. Start a run to see live output.
                  </div>
                )}
                {logs.map((log, i) => {
                  const color = log.level === 'error' ? '#f87171'
                              : log.level === 'warn'  ? '#fbbf24'
                              : '#a3e635';
                  const time = new Date(log.ts).toLocaleTimeString('en-US', { hour12: false });
                  // Highlight key tokens
                  const msg = log.msg
                    .replace(/\[W(\d+)\]/g, '<span style="color:#818cf8">[W$1]</span>')
                    .replace(/\[AdEngine\]/g, '<span style="color:#38bdf8">[AdEngine]</span>')
                    .replace(/(✓|✗|⚠)/g, '<span style="color:#fbbf24">$1</span>')
                    .replace(/(Proxy: [^\s|]+)/g, '<span style="color:#fb923c">$1</span>');
                  return (
                    <div key={i} style={{ display: 'flex', gap: '10px', paddingBottom: '2px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ color: '#4b5563', flexShrink: 0 }}>{time}</span>
                      <span style={{ color, flexShrink: 0, width: 36 }}>{log.level.toUpperCase().slice(0,3)}</span>
                      <span style={{ color: '#d1d5db' }} dangerouslySetInnerHTML={{ __html: msg }} />
                    </div>
                  );
                })}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
