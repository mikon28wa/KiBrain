import { loadConfig, saveConfig } from './config';

declare const chrome: any;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setStatus(text: string): void {
  el<HTMLPreElement>('status').textContent = text;
}

async function init(): Promise<void> {
  const config = await loadConfig();
  el<HTMLInputElement>('endpoint').value = config.endpoint;
  el<HTMLInputElement>('token').value = config.token;
}

el<HTMLFormElement>('config').addEventListener('submit', async (event) => {
  event.preventDefault();
  const endpoint = el<HTMLInputElement>('endpoint').value.trim();
  const token = el<HTMLInputElement>('token').value.trim();
  await saveConfig({ endpoint, token });
  setStatus('Saved locally.');
});

el<HTMLButtonElement>('backup').addEventListener('click', async () => {
  setStatus('Running backup…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'KIBRAIN_BACKUP_NOW' });
    if (response?.ok) setStatus(`Done: ${JSON.stringify(response.result)}`);
    else setStatus(`Error: ${response?.error ?? 'unknown'}`);
  } catch (error) {
    setStatus(`Error: ${String(error)}`);
  }
});

void init();
