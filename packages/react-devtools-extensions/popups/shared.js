/* globals chrome */

'use strict';

document.addEventListener('DOMContentLoaded', function() {
  // Make links work
  const links = document.getElementsByTagName('a');
  for (let i = 0; i < links.length; i++) {
    (function() {
      const ln = links[i];
      const location = ln.href;
      ln.onclick = function() {
        chrome.tabs.create({active: true, url: location});
        return false;
      };
    })();
  }

  // Work around https://bugs.chromium.org/p/chromium/issues/detail?id=428044
  document.body.style.opacity = 0;
  document.body.style.transition = 'opacity ease-out .4s';
  requestAnimationFrame(function() {
    document.body.style.opacity = 1;
  });

  const button = document.getElementById('refresh_component_name_area');
  console.log('shared.js button:', button);
  if (button) {
    button.addEventListener('click', () => {
      console.log('shared.js clicked');
      const msg = chrome.runtime.sendMessage(
        {
          source: 'shared.js',
          queryReactComponents: true,
        },
        response => {
          console.log('shared.js resp:', response);
          if (response) {
            const area = document.getElementById('component_name_area');
            console.log('shared.js area:', area);
            if (area) {
              area.innerHTML = JSON.stringify(response.namesMap, null, 2);
            }
          } else {
            console.log(
              'shared.js chrome.runtime.lastError:',
              chrome.runtime.lastError
            );
          }
        }
      );
      console.log('shared.js sendMessage result:', msg);
    });
  }
});
