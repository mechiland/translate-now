import './startup.css';

// Chrome waits for the document's load event before showing the popup. Keep this
// entry dependency-free, then let the static loading surface paint before React.
window.addEventListener('load', () => {
  requestAnimationFrame(() => {
    setTimeout(() => {
      void import('./render')
        .then(({ mountPopup }) => mountPopup())
        .catch((error: unknown) => {
          console.error('[translate-now] popup startup failed', error);
          const loading = document.getElementById('popup-loading')!;
          loading.setAttribute('role', 'alert');
          loading.setAttribute('aria-label', 'Translate Now');
          loading.setAttribute('aria-busy', 'false');
          loading.querySelector('.popup-placeholders')?.remove();

          const chinese = navigator.language.toLowerCase().startsWith('zh');
          const message = document.createElement('p');
          message.textContent = chinese
            ? '暂时无法打开，请重试。'
            : 'Unable to open. Please try again.';
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.textContent = chinese ? '重试' : 'Retry';
          retry.addEventListener('click', () => window.location.reload());
          loading.append(message, retry);
        });
    }, 0);
  });
});
