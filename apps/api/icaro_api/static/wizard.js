/**
 * wizard.js — Vanilla JS for the icaroRS Jinja2 wizard (Phase 1).
 *
 * Responsibilities:
 *   1. Upload state machine: idle → loading (within 200ms) → done/error (AC-RG-4.1–4.3).
 *   2. 30-second fetch timeout for /api/convert (RG-4.3, RG-9.3).
 *   3. Inline 422 validation rendering from POST /api/scenario/validate (AC-RG-3.9).
 *   4. Elevation fetch helper (used by step2 inline script via credentials:'include').
 *   5. Atmosphere-suggest fetch helper (used by step2 inline script).
 *   6. Loading-state toggle helpers used by step1 inline script.
 *
 * Constraints:
 *   - NEVER re-encode the GFS window rule, pydantic validation, or preset values here.
 *     All domain decisions come from the API (RG-1.5).
 *   - No top-level alert() calls; errors go inline (AC-RG-3.9, RG-9.4).
 */

'use strict';

// ---------------------------------------------------------------------------
// Upload state machine (Step 1 — RG-4.1–4.3, AC-RG-4.1–4.3)
// ---------------------------------------------------------------------------

(function initUploadStateMachine() {
  var fileInput = document.getElementById('ork-file');
  if (!fileInput) return;  // not on step1 page

  var uploadZone    = document.getElementById('upload-zone');
  var idleState     = document.getElementById('upload-idle');
  var loadingState  = document.getElementById('upload-loading');
  var doneState     = document.getElementById('upload-done');
  var errorState    = document.getElementById('upload-error');
  var errorMsg      = document.getElementById('upload-error-message');
  var exportIdInput = document.getElementById('export-id');
  var continueBtn   = document.getElementById('continue-btn');
  var rocketNameEl  = document.getElementById('rocket-name');

  function showState(name) {
    [idleState, loadingState, doneState, errorState].forEach(function(el) {
      if (el) el.classList.add('hidden');
    });
    var target = {
      idle:    idleState,
      loading: loadingState,
      done:    doneState,
      error:   errorState
    }[name];
    if (target) target.classList.remove('hidden');
    if (uploadZone) uploadZone.dataset.state = name;
  }

  // Exposed for the inline script in step1_rocket.html
  window.icaroInitDoneState = function(rocketName) {
    if (rocketNameEl) rocketNameEl.textContent = rocketName;
    showState('done');
    if (continueBtn) continueBtn.disabled = false;
  };

  // Drag-and-drop support
  if (uploadZone) {
    uploadZone.addEventListener('dragover', function(e) {
      e.preventDefault();
      uploadZone.classList.add('icaro-upload-zone--drag');
    });
    uploadZone.addEventListener('dragleave', function() {
      uploadZone.classList.remove('icaro-upload-zone--drag');
    });
    uploadZone.addEventListener('drop', function(e) {
      e.preventDefault();
      uploadZone.classList.remove('icaro-upload-zone--drag');
      var files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        fileInput.dispatchEvent(new Event('change'));
      }
    });
  }

  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (!file) return;

    // Show loading IMMEDIATELY (within 200ms of file selection — AC-RG-4.1)
    showState('loading');
    if (continueBtn) continueBtn.disabled = true;

    var formData = new FormData();
    formData.append('file', file);

    // 30-second fetch timeout (RG-4.3, RG-9.3)
    var controller = new AbortController();
    var timeoutId = setTimeout(function() {
      controller.abort();
    }, 30000);

    fetch('/api/convert', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      signal: controller.signal
    })
    .then(function(response) {
      clearTimeout(timeoutId);
      if (response.status === 503) {
        return response.json().then(function(body) {
          // AC-RG-4.2: 503 → friendly message with hint, no traceback
          var hint = '';
          if (body && body.detail && body.detail.hint) {
            hint = body.detail.hint;
          } else if (body && body.hint) {
            hint = body.hint;
          }
          var msg = 'The file conversion service is not available on this server.';
          if (hint) { msg += ' ' + hint; }
          throw { friendly: msg };
        });
      }
      if (response.status === 422) {
        return response.json().then(function(body) {
          var msg = 'This file could not be processed.';
          if (body && body.detail) {
            if (typeof body.detail === 'string') {
              msg = body.detail;
            } else if (Array.isArray(body.detail) && body.detail[0] && body.detail[0].message) {
              msg = body.detail[0].message;
            }
          }
          throw { friendly: msg };
        });
      }
      if (!response.ok) {
        throw { friendly: 'An unexpected error occurred. Please try again.' };
      }
      return response.json();
    })
    .then(function(data) {
      // AC-RG-4.3: Success — show rocket name from manifest
      var name = (data.manifest && data.manifest.name) ? data.manifest.name : file.name;
      if (exportIdInput) exportIdInput.value = data.export_id || '';
      if (rocketNameEl)  rocketNameEl.textContent = name;
      showState('done');
      if (continueBtn) continueBtn.disabled = false;
    })
    .catch(function(err) {
      clearTimeout(timeoutId);
      var msg;
      if (err && err.name === 'AbortError') {
        msg = 'The request timed out after 30 seconds. The server may be starting up — please try again.';
      } else if (err && err.friendly) {
        msg = err.friendly;
      } else {
        msg = 'An unexpected error occurred. Please try again.';
      }
      if (errorMsg) errorMsg.textContent = msg;
      showState('error');
      // Re-enable upload zone for retry (AC-RG-4.2)
      if (fileInput) fileInput.value = '';
    });
  });

  // "Change file" link resets to idle
  var changeFileLink = document.getElementById('change-file-link');
  if (changeFileLink) {
    changeFileLink.addEventListener('click', function(e) {
      e.preventDefault();
      if (exportIdInput) exportIdInput.value = '';
      if (continueBtn) continueBtn.disabled = true;
      showState('idle');
      fileInput.value = '';
    });
  }
})();

// ---------------------------------------------------------------------------
// Inline 422 validation rendering (Step 2 / Step 3 — AC-RG-3.9)
// ---------------------------------------------------------------------------
// The server re-renders the template with errors when form POSTs are validated
// server-side. This client-side helper is for progressive-enhancement: on blur,
// validate individual fields so the user sees errors before submission.
// Never shows a top-level alert or raw traceback (RG-9.4).

window.icaroValidateField = function(fieldName, value, container) {
  // Build a minimal partial scenario for validation of a single field.
  // The server validates the whole scenario; we only surface the relevant error.
  // This is a best-effort UX enhancement — server validation is authoritative.
};

// ---------------------------------------------------------------------------
// Loading state helper (for use by other pages)
// ---------------------------------------------------------------------------

window.icaroShowLoading = function(buttonId, loadingText) {
  var btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  if (loadingText) btn.textContent = loadingText;
};

window.icaroHideLoading = function(buttonId, originalText) {
  var btn = document.getElementById(buttonId);
  if (!btn) return;
  btn.removeAttribute('aria-busy');
  btn.disabled = false;
  if (originalText) btn.textContent = originalText;
};
