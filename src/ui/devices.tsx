// @ts-nocheck
// Playing the same league on several devices: a save file, or a cloud copy in the player's own GitHub Gist.
import { useEffect, useRef, useState } from 'react';
import { downloadLeague, importFile, cloudToken, setCloudToken, cloudAuto, setCloudAuto, cloudList, cloudDownload, cloudDelete, cloudSync, cloudStatus } from '../cloud';
import { currentSlot } from '../api';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=NBA%20History%20Simulator%20saves';
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };

export function Devices({ lg, onLoad }: any) {
  const [token, setToken] = useState(cloudToken());
  const [input, setInput] = useState('');
  const [auto, setAuto] = useState(cloudAuto());
  const [list, setList] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const f = () => bump(x => x + 1); cloudStatus.listeners.add(f); return () => { cloudStatus.listeners.delete(f); }; }, []);
  const act = async (fn: () => Promise<any>, ok?: string) => { setBusy(true); setMsg(''); try { await fn(); if (ok) setMsg(ok); } catch (e: any) { setMsg('⚠ ' + (e?.message ?? e)); } finally { setBusy(false); } };
  const refresh = () => act(async () => setList(await cloudList()));
  useEffect(() => { if (token) refresh(); }, [token]);

  return (
    <div className="devices">
      <h3>Other devices</h3>
      <div className="dev-row">
        {lg && <button className="small" disabled={busy} onClick={() => act(() => downloadLeague(lg), 'Save file downloaded – open it on the other device with “Open save file”.')}>Download save file</button>}
        <button className="small" disabled={busy} onClick={() => fileRef.current?.click()}>Open save file…</button>
        <input ref={fileRef} type="file" accept=".nbasave,.json,.gz,application/gzip,application/json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) act(async () => { const id = await importFile(f); onLoad(id); }); }} />
      </div>
      {!token ? (
        <div className="dev-cloud">
          <p className="note"><b>Cloud copy (sync between your devices).</b> Saves go to a private Gist in your own GitHub account – nothing else is stored anywhere. Once per device: <a href={TOKEN_URL} target="_blank" rel="noopener">create a GitHub token</a> with only the <b>gist</b> permission, then paste it here. The token stays in this browser.</p>
          <div className="dev-row">
            <input type="password" placeholder="ghp_… or github_pat_…" value={input} onChange={e => setInput(e.target.value)} aria-label="GitHub token" />
            <button className="small primary" disabled={!input.trim() || busy} onClick={() => act(async () => { setCloudToken(input); await cloudList(); setToken(cloudToken()); setInput(''); setCloudAuto(true); setAuto(true); }, 'Connected. This league will now be copied to the cloud automatically.')}>Connect</button>
          </div>
        </div>
      ) : (
        <div className="dev-cloud">
          <div className="dev-row">
            {lg && <button className="small primary" disabled={busy || cloudStatus.busy} onClick={() => act(async () => { await cloudSync(lg, currentSlot()); if (cloudStatus.error) throw new Error(cloudStatus.error); await refresh(); }, 'Uploaded.')}>Upload this league now</button>}
            <label className="dev-auto"><input type="checkbox" checked={auto} onChange={e => { setCloudAuto(e.target.checked); setAuto(e.target.checked); }} /> Upload automatically after saving</label>
            <button className="small ghost" onClick={() => { setCloudToken(null); setToken(null); setList(null); setCloudAuto(false); setAuto(false); }}>Disconnect</button>
          </div>
          <p className="note">{cloudStatus.busy ? 'Uploading…' : cloudStatus.error ? '⚠ Last upload failed: ' + cloudStatus.error : cloudStatus.last ? `Last upload ${ago(cloudStatus.last)}.` : 'Connected to your GitHub Gist.'} On another device: connect with a token too, then load the league from the list below.</p>
          {list && (list.length ? (
            <ul className="save-list">{list.map(c => (
              <li key={c.file}>
                <span><b>{c.name}</b><br /><span className="dim">{c.label} · uploaded {ago(c.updated)} · {(c.size / 1024 / 1024 * 0.75).toFixed(1)} MB</span></span>
                <span className="save-actions">
                  <button className="small primary" disabled={busy} onClick={() => act(async () => { const id = await cloudDownload(c.file); onLoad(id); })}>Load here</button>
                  <button className="small ghost" disabled={busy} onClick={() => act(async () => { await cloudDelete(c.file); await refresh(); })}>Remove</button>
                </span>
              </li>
            ))}</ul>
          ) : <p className="note">No leagues in the cloud yet.</p>)}
        </div>
      )}
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
