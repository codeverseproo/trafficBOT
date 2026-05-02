"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyManager = void 0;
class ProxyManager {
    store;
    rrIndex = 0; // round-robin cursor
    stickyMap = new Map(); // url host → proxy id
    constructor(store) {
        this.store = store;
    }
    getProxies() {
        return this.store.get('proxies', []);
    }
    addProxy(proxy) {
        const proxies = this.getProxies();
        proxies.push({ ...proxy, healthScore: 100, failures: 0 });
        this.store.set('proxies', proxies);
    }
    bulkImport(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
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
                    });
                }
                catch { }
            }
            else {
                const parts = line.split(':');
                if (parts.length >= 2) {
                    parsed.push({
                        id: Date.now().toString() + Math.random().toString(),
                        server: `http://${parts[0]}:${parts[1]}`,
                        username: parts[2] || undefined,
                        password: parts[3] || undefined,
                    });
                }
            }
        }
        const proxies = this.getProxies();
        for (const p of parsed)
            proxies.push({ ...p, healthScore: 100, failures: 0 });
        this.store.set('proxies', proxies);
        return parsed.length;
    }
    deleteProxy(id) {
        const proxies = this.getProxies().filter(p => p.id !== id);
        this.store.set('proxies', proxies);
    }
    // ─── Rotation Strategies ─────────────────────────────────────────────────
    getNextProxy(mode = 'smart', targetUrl, targetCountry) {
        const healthy = this.getProxies().filter(p => p.healthScore > 20);
        if (healthy.length === 0)
            return null;
        switch (mode) {
            case 'round-robin': {
                this.rrIndex = this.rrIndex % healthy.length;
                const proxy = healthy[this.rrIndex++];
                this.updateProxyStats(proxy.id, { lastUsed: Date.now() });
                return proxy;
            }
            case 'random': {
                const proxy = healthy[Math.floor(Math.random() * healthy.length)];
                this.updateProxyStats(proxy.id, { lastUsed: Date.now() });
                return proxy;
            }
            case 'geo-match': {
                if (targetCountry) {
                    const geo = healthy.filter(p => p.country === targetCountry);
                    const pool = geo.length > 0 ? geo : healthy;
                    const proxy = pool[Math.floor(Math.random() * pool.length)];
                    this.updateProxyStats(proxy.id, { lastUsed: Date.now() });
                    return proxy;
                }
                return this.getNextProxy('smart');
            }
            case 'sticky': {
                if (targetUrl) {
                    const host = (() => { try {
                        return new URL(targetUrl).hostname;
                    }
                    catch {
                        return targetUrl;
                    } })();
                    const stickId = this.stickyMap.get(host);
                    if (stickId) {
                        const proxy = healthy.find(p => p.id === stickId);
                        if (proxy)
                            return proxy;
                    }
                    const selected = healthy[Math.floor(Math.random() * healthy.length)];
                    this.stickyMap.set(host, selected.id);
                    this.updateProxyStats(selected.id, { lastUsed: Date.now() });
                    return selected;
                }
                return this.getNextProxy('smart');
            }
            case 'smart':
            default: {
                // Prefer residential, high health, least recently used
                const sorted = [...healthy].sort((a, b) => {
                    const resA = a.isDatacenter ? 0 : 1;
                    const resB = b.isDatacenter ? 0 : 1;
                    if (resB !== resA)
                        return resB - resA; // residential first
                    if (b.healthScore !== a.healthScore)
                        return b.healthScore - a.healthScore;
                    return (a.lastUsed || 0) - (b.lastUsed || 0);
                });
                const proxy = sorted[0];
                this.updateProxyStats(proxy.id, { lastUsed: Date.now() });
                return proxy;
            }
        }
    }
    // ─── Proxy Failover Chain ────────────────────────────────────────────────
    getFailoverProxy(excludeIds) {
        const healthy = this.getProxies().filter(p => p.healthScore > 20 && !excludeIds.includes(p.id));
        if (healthy.length === 0)
            return null;
        healthy.sort((a, b) => b.healthScore - a.healthScore);
        const proxy = healthy[0];
        this.updateProxyStats(proxy.id, { lastUsed: Date.now() });
        return proxy;
    }
    // ─── Residential vs Datacenter Classifier ────────────────────────────────
    classifyISP(isp) {
        const dcKeywords = [
            'amazon', 'aws', 'google', 'microsoft', 'azure', 'digitalocean',
            'linode', 'hetzner', 'ovh', 'vultr', 'cloudflare', 'leaseweb',
            'cogent', 'rackspace', 'choopa', 'quadranet', 'psychz',
        ];
        const lower = isp.toLowerCase();
        return dcKeywords.some(kw => lower.includes(kw));
    }
    // ─── Geo Enrichment (called post Smart Sync) ─────────────────────────────
    updateProxyGeo(id, data) {
        const isDatacenter = data.isp ? this.classifyISP(data.isp) : undefined;
        this.updateProxyStats(id, { ...data, isDatacenter });
    }
    // ─── Health Reporting ────────────────────────────────────────────────────
    reportProxySuccess(id) {
        const proxy = this.getProxies().find(p => p.id === id);
        if (proxy) {
            this.updateProxyStats(id, { healthScore: Math.min(100, proxy.healthScore + 5), failures: 0 });
        }
    }
    reportProxyFailure(id) {
        const proxy = this.getProxies().find(p => p.id === id);
        if (proxy) {
            const newF = proxy.failures + 1;
            const newH = Math.max(0, proxy.healthScore - newF * 10);
            this.updateProxyStats(id, { healthScore: newH, failures: newF });
        }
    }
    // ─── Export ──────────────────────────────────────────────────────────────
    exportAsText() {
        return this.getProxies()
            .map(p => {
            try {
                const u = new URL(p.server);
                if (p.username && p.password) {
                    return `${u.protocol}//${p.username}:${p.password}@${u.hostname}:${u.port}`;
                }
                return p.server;
            }
            catch {
                return p.server;
            }
        })
            .join('\n');
    }
    updateProxyStats(id, updates) {
        const proxies = this.getProxies();
        const idx = proxies.findIndex(p => p.id === id);
        if (idx !== -1) {
            proxies[idx] = { ...proxies[idx], ...updates };
            this.store.set('proxies', proxies);
        }
    }
}
exports.ProxyManager = ProxyManager;
