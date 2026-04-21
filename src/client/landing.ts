const createForm = document.getElementById('create-form') as HTMLFormElement | null;
const joinForm = document.getElementById('join-form') as HTMLFormElement | null;
const joinError = document.getElementById('join-error') as HTMLElement | null;

function saveIdentity(code: string, name: string, participantId: string | null) {
  try {
    localStorage.setItem(
      `spp:${code}`,
      JSON.stringify({ participantId, name })
    );
  } catch {
    // localStorage disabled, the room page will re-prompt for name.
  }
}

function showError(msg: string) {
  if (joinError) joinError.textContent = msg;
}

createForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('host-name') as HTMLInputElement;
  const name = (nameInput.value || '').trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const btn = createForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Opening room…';
  try {
    const resp = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) throw new Error('bad response');
    const data = (await resp.json()) as { code: string; participantId: string };
    saveIdentity(data.code, name, data.participantId);
    location.href = `/r/${data.code}`;
  } catch {
    btn.disabled = false;
    btn.innerHTML =
      '<span>Start a new room</span><svg width="18" height="12" viewBox="0 0 18 12"><path d="M1 6h15m0 0L11 1m5 5l-5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
    showError("Couldn't reach the server. Try again?");
  }
});

joinForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const codeInput = document.getElementById('join-code') as HTMLInputElement;
  const nameInput = document.getElementById('join-name') as HTMLInputElement;
  const code = (codeInput.value || '').trim().toUpperCase();
  const name = (nameInput.value || '').trim();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    showError('Codes are six letters/digits, like ABC123.');
    codeInput.focus();
    return;
  }
  if (!name) {
    nameInput.focus();
    return;
  }
  try {
    const resp = await fetch(`/api/sessions/${encodeURIComponent(code)}`);
    if (!resp.ok) throw new Error('bad response');
    const { exists } = (await resp.json()) as { exists: boolean };
    if (!exists) {
      showError("No session with that code. Maybe it's expired?");
      return;
    }
    saveIdentity(code, name, null);
    location.href = `/r/${code}`;
  } catch {
    showError("Couldn't reach the server. Try again?");
  }
});

// Live-uppercase the join code as the user types, for that tactile vibe.
const codeEl = document.getElementById('join-code') as HTMLInputElement | null;
codeEl?.addEventListener('input', () => {
  const pos = codeEl.selectionStart;
  codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (pos !== null) codeEl.setSelectionRange(pos, pos);
});
