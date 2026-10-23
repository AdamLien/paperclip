const status = document.querySelector('#status');
document.querySelector('#share').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ type: 'share', tabId: tab.id,
      origin: document.querySelector('#origin').value, token: document.querySelector('#token').value.trim() });
    status.textContent = result.error ?? '已分享目前分頁，可回到 mCrew 查看。';
    if (!result.error) document.querySelector('#token').value = '';
  } catch { status.textContent = '無法分享，請回到 App 重新配對。'; }
};
document.querySelector('#stop').onclick = async () => {
  await chrome.runtime.sendMessage({ type: 'stop' }); status.textContent = '已停止分享。';
};
