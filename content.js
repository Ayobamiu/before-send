// Send Check for Gmail - Gmail Send Interceptor
// Content script that runs on Gmail pages

(function () {
  'use strict';

  console.log('Send Check for Gmail: Extension loaded on Gmail');

  let sendIntercepted = false;
  let pendingSendAction = null; // Store the original send method: 'keyboard' or 'button'
  let isResumingSend = false; // Flag to prevent re-interception when resuming

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('Send Check for Gmail: Initializing...');
    setupSendInterception();
  }

  /**
   * Step 2: Detect Send action
   * Intercepts Cmd/Ctrl+Enter and Send button clicks
   */
  function setupSendInterception() {
    // Intercept keyboard shortcut (Cmd/Ctrl + Enter)
    document.addEventListener('keydown', handleKeyboardShortcut, true);

    // Intercept Send button clicks using event delegation
    document.addEventListener('click', handleSendButtonClick, true);

    console.log('Send Check for Gmail: Send interception set up');
  }

  /**
   * Handle keyboard shortcut: Cmd/Ctrl + Enter
   */
  function handleKeyboardShortcut(event) {
    // Check if Cmd (Mac) or Ctrl (Windows/Linux) + Enter
    const isModifierPressed = event.metaKey || event.ctrlKey;
    const isEnter = event.key === 'Enter' || event.keyCode === 13;

    if (isModifierPressed && isEnter) {
      // Check if we're in a compose window
      const composeWindow = findComposeWindow();

      if (composeWindow) {
        // Always prevent the send action
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        // Only process if not already intercepted
        if (!sendIntercepted) {
          console.log('Send Check for Gmail: Intercepted Cmd/Ctrl+Enter');
          interceptSend('keyboard');
        } else {
          console.log('Send Check for Gmail: Send already intercepted, preventing duplicate');
        }
      }
    }
  }

  /**
   * Handle Send button click
   */
  function handleSendButtonClick(event) {
    // Skip if we're resuming a send (to prevent re-interception)
    if (isResumingSend) {
      return;
    }

    const target = event.target;

    // Check if clicked element or its parent is a Send button
    const sendButton = findSendButton(target);

    if (sendButton) {
      // Always prevent the send action
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Only process if not already intercepted
      if (!sendIntercepted) {
        console.log('Send Check for Gmail: Intercepted Send button click');
        interceptSend('button');
      } else {
        console.log('Send Check for Gmail: Send already intercepted, preventing duplicate');
      }
    }
  }

  /**
   * Find Send button in the DOM tree
   */
  function findSendButton(element) {
    let current = element;
    let depth = 0;
    const maxDepth = 5; // Limit search depth

    while (current && depth < maxDepth) {
      // Gmail Send button typically has:
      // - aria-label containing "Send"
      // - text content "Send"
      // - role="button" and contains "Send" text
      const ariaLabel = current.getAttribute?.('aria-label') || '';
      const textContent = current.textContent?.trim() || '';
      const role = current.getAttribute?.('role') || '';

      if (
        (ariaLabel.toLowerCase().includes('send') &&
          !ariaLabel.toLowerCase().includes('draft') &&
          !ariaLabel.toLowerCase().includes('schedule')) ||
        (textContent === 'Send' && role === 'button') ||
        (current.tagName === 'DIV' && textContent === 'Send' &&
          current.getAttribute?.('role') === 'button')
      ) {
        // Verify it's actually in a compose window
        const composeWindow = findComposeWindow();
        if (composeWindow && composeWindow.contains(current)) {
          return current;
        }
      }

      current = current.parentElement;
      depth++;
    }

    return null;
  }

  /**
   * Find the compose window element
   * Works for both new compose (role="dialog") and reply (role="region")
   */
  function findComposeWindow() {
    // Gmail compose window can be identified by:
    // - New compose: role="dialog" that contains compose elements
    // - Reply: role="region" with data-compose-id that contains compose elements
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const regions = document.querySelectorAll('[role="region"][data-compose-id]');

    // Check dialogs (new compose)
    for (const dialog of dialogs) {
      // Check if this dialog contains compose-related elements
      const messageElement = dialog.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
        dialog.querySelector('[contenteditable="true"][aria-label*="Compose"]');
      const toInput = dialog.querySelector('input[aria-label*="To"]') ||
        dialog.querySelector('input[aria-label*="Recipients"]');
      const hasComposeElements = messageElement || toInput;

      if (hasComposeElements) {
        return dialog;
      }
    }

    // Check regions (reply windows)
    for (const region of regions) {
      // Check if this region contains compose-related elements
      // Reply windows have: contenteditable with aria-label="Message Body"
      const messageElement = region.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
        region.querySelector('[contenteditable="true"][aria-label*="Compose"]');

      // Reply windows use combobox for To field, not input
      const toField = region.querySelector('[aria-label*="To recipients"]') ||
        region.querySelector('[aria-label*="To"]') ||
        region.querySelector('input[aria-label*="To"]') ||
        region.querySelector('input[aria-label*="Recipients"]');

      const hasComposeElements = messageElement || toField;

      if (hasComposeElements) {
        return region;
      }
    }

    return null;
  }

  /**
   * Intercept send action and prevent it temporarily
   */
  function interceptSend(source) {
    if (sendIntercepted) {
      console.log('Send Check for Gmail: Already processing a send, ignoring duplicate');
      return;
    }

    sendIntercepted = true;
    pendingSendAction = source; // Store the original send method
    console.log('Send Check for Gmail: Send intercepted from', source);

    // Step 3: Extract email data
    const emailData = extractEmailData();
    console.log('Send Check for Gmail: Extracted email data:', emailData);

    // Step 4: Run rules engine
    const warnings = runRulesEngine(emailData);
    console.log('Send Check for Gmail: Warnings detected:', warnings);

    // Step 5: Show modal if warnings exist
    if (warnings.length > 0) {
      showWarningModal(warnings);
    } else {
      // No warnings, proceed with send
      console.log('Send Check for Gmail: No warnings, proceeding with send');
      setTimeout(() => {
        resumeSend();
      }, 50);
    }
  }

  /**
   * Step 3: Extract email data from compose window
   * Returns: { messageText, hasAttachment, currentHour }
   */
  function extractEmailData() {
    const composeWindow = findComposeWindow();
    if (!composeWindow) {
      return {
        messageText: '',
        hasAttachment: false,
        currentHour: new Date().getHours()
      };
    }

    // Extract message text from contenteditable element
    let messageText = '';
    const messageElement = composeWindow.querySelector('[contenteditable="true"][aria-label*="Message"]') ||
      composeWindow.querySelector('[contenteditable="true"][aria-label*="Compose"]') ||
      composeWindow.querySelector('[contenteditable="true"]');

    if (messageElement) {
      messageText = messageElement.textContent || messageElement.innerText || '';
    }

    // Check for attachments
    // Based on Gmail's actual structure: look for specific attachment indicators
    let hasAttachment = false;

    // Method 1: Look for attachment container with aria-label starting with "Attachment:"
    // This is the most reliable indicator - Gmail uses: aria-label="Attachment: filename.pdf..."
    const attachmentContainers = composeWindow.querySelectorAll('[aria-label^="Attachment:"]');
    if (attachmentContainers.length > 0) {
      hasAttachment = true;
    }

    // Method 2: Look for "Remove attachment" button (only appears when file is attached)
    if (!hasAttachment) {
      const removeButtons = composeWindow.querySelectorAll('[aria-label="Remove attachment"]');
      if (removeButtons.length > 0) {
        hasAttachment = true;
      }
    }

    // Method 3: Look for hidden input with name="attach" (Gmail uses this for attached files)
    if (!hasAttachment) {
      const attachInputs = composeWindow.querySelectorAll('input[name="attach"][type="hidden"]');
      // Only count if the input is checked (file is actually attached)
      for (const input of attachInputs) {
        if (input.hasAttribute('checked') || input.checked) {
          hasAttachment = true;
          break;
        }
      }
    }

    // Get current local hour (0-23)
    const currentHour = new Date().getHours();

    return {
      messageText: messageText.trim(),
      hasAttachment: hasAttachment,
      currentHour: currentHour
    };
  }

  /**
   * Step 4: Rules engine
   * Checks for: missing attachment, late-night send, tone issues
   * Returns: Array of warning messages
   */
  function runRulesEngine(emailData) {
    const warnings = [];
    const { messageText, hasAttachment, currentHour } = emailData;

    // Rule 1: Missing attachment
    // Check if message mentions attachment-related words but no attachment exists
    const attachmentKeywords = [
      'attached', 'included', 'see file', 'see attachment',
      'find attached', 'enclosed', 'see the file', 'see the attachment',
      'i\'ve attached', 'i have attached', 'please find attached',
      'i\'m attaching', 'i am attaching', 'attaching'
    ];

    const messageLower = messageText.toLowerCase();
    const mentionsAttachment = attachmentKeywords.some(keyword =>
      messageLower.includes(keyword)
    );

    if (mentionsAttachment && !hasAttachment) {
      warnings.push('You mentioned an attachment, but didn\'t attach anything.');
    }

    // Rule 2: Late-night send
    // Warn if sending between 10pm (22:00) and 6am (06:00)
    if (currentHour >= 22 || currentHour < 6) {
      warnings.push(`It's late (${currentHour}:00). Want to send this during business hours?`);
    }

    // Rule 3: Tone heuristic
    // Check for ALL CAPS, excessive exclamation marks, or strong negative words
    const messageWords = messageText.split(/\s+/);
    const allCapsWords = messageWords.filter(word =>
      word.length > 2 && word === word.toUpperCase() && /[A-Z]/.test(word)
    );

    // If more than 20% of words (excluding very short words) are ALL CAPS, warn
    const significantWords = messageWords.filter(word => word.length > 2);
    if (significantWords.length > 0) {
      const capsRatio = allCapsWords.length / significantWords.length;
      if (capsRatio > 0.2) {
        warnings.push('This message is mostly in ALL CAPS, which can sound aggressive.');
      }
    }

    // Check for excessive exclamation marks (3+ in a row)
    if (messageText.includes('!!!')) {
      warnings.push('This message has a lot of exclamation marks (!!!), which can seem intense.');
    }

    // Check for strong negative words
    const negativeWords = [
      'hate', 'stupid', 'idiot', 'moron', 'terrible',
      'awful', 'horrible', 'worst', 'disgusting', 'pathetic'
    ];
    const hasNegativeWords = negativeWords.some(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(messageText);
    });

    if (hasNegativeWords) {
      warnings.push('This message sounds a bit tense. Want to soften it?');
    }

    return warnings;
  }

  /**
   * Step 5: Warning modal
   * Shows a modal overlay with detected issues and action buttons
   */
  function showWarningModal(warnings) {
    // Remove existing modal if any
    const existingModal = document.getElementById('before-you-send-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'before-you-send-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    `;

    // Create modal content box
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    // Create title
    const title = document.createElement('h2');
    title.textContent = 'Send Check for Gmail';
    title.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 20px;
      font-weight: 600;
      color: #202124;
    `;

    // Create warning message
    const warningText = document.createElement('p');
    warningText.textContent = 'We noticed a few things:';
    warningText.style.cssText = `
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #5f6368;
    `;

    // Create warnings list
    const warningsList = document.createElement('ul');
    warningsList.style.cssText = `
      margin: 0 0 24px 0;
      padding-left: 20px;
      list-style-type: disc;
    `;

    warnings.forEach(warning => {
      const listItem = document.createElement('li');
      listItem.textContent = warning;
      listItem.style.cssText = `
        margin-bottom: 8px;
        font-size: 14px;
        color: #ea4335;
        line-height: 1.5;
      `;
      warningsList.appendChild(listItem);
    });

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    `;

    // Create "Fix" button (cancel send)
    const fixButton = document.createElement('button');
    fixButton.textContent = 'Fix';
    fixButton.style.cssText = `
      padding: 10px 24px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      background: white;
      color: #202124;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    `;
    fixButton.addEventListener('mouseenter', () => {
      fixButton.style.backgroundColor = '#f8f9fa';
    });
    fixButton.addEventListener('mouseleave', () => {
      fixButton.style.backgroundColor = 'white';
    });
    fixButton.addEventListener('click', () => {
      cancelSend();
    });

    // Create "Send anyway" button
    const sendAnywayButton = document.createElement('button');
    sendAnywayButton.textContent = 'Send anyway';
    sendAnywayButton.style.cssText = `
      padding: 10px 24px;
      border: none;
      border-radius: 4px;
      background: #1a73e8;
      color: white;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    `;
    sendAnywayButton.addEventListener('mouseenter', () => {
      sendAnywayButton.style.backgroundColor = '#1765cc';
    });
    sendAnywayButton.addEventListener('mouseleave', () => {
      sendAnywayButton.style.backgroundColor = '#1a73e8';
    });
    sendAnywayButton.addEventListener('click', () => {
      closeModal();
      console.log('Send Check for Gmail: User chose to send anyway');
      resumeSend();
    });

    // Assemble modal
    buttonContainer.appendChild(fixButton);
    buttonContainer.appendChild(sendAnywayButton);

    modalContent.appendChild(title);
    modalContent.appendChild(warningText);
    modalContent.appendChild(warningsList);
    modalContent.appendChild(buttonContainer);

    modal.appendChild(modalContent);

    // Add click outside to close (cancel send)
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        cancelSend();
      }
    });

    // Handle ESC key to cancel
    const handleEscape = (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        cancelSend();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Add to document
    document.body.appendChild(modal);

    // Focus on Fix button for accessibility
    fixButton.focus();
  }

  /**
   * Close modal and reset state
   */
  function closeModal() {
    const modal = document.getElementById('before-you-send-modal');
    if (modal) {
      modal.remove();
    }
  }

  /**
   * Cancel send (user clicked "Fix" or closed modal)
   */
  function cancelSend() {
    closeModal();
    sendIntercepted = false;
    pendingSendAction = null;
    console.log('Send Check for Gmail: Send cancelled by user');
  }

  /**
   * Step 6: Resume the original send action
   * Called when user clicks "Send anyway" or when no warnings exist
   */
  function resumeSend() {
    if (!pendingSendAction) {
      console.log('Send Check for Gmail: No pending send action to resume');
      sendIntercepted = false;
      return;
    }

    const action = pendingSendAction;

    // Reset state
    sendIntercepted = false;
    pendingSendAction = null;
    isResumingSend = true; // Prevent re-interception

    console.log('Send Check for Gmail: Resuming send from', action);

    // Small delay to ensure state is reset before triggering send
    setTimeout(() => {
      const composeWindow = findComposeWindow();
      if (composeWindow) {
        if (action === 'button') {
          // Find and click the Send button
          const sendButton = composeWindow.querySelector('[aria-label*="Send"]:not([aria-label*="draft"]):not([aria-label*="schedule"])');
          if (sendButton) {
            sendButton.click();
          } else {
            console.log('Send Check for Gmail: Send button not found, trying alternative method');
            // Fallback: try to find by text content
            const buttons = composeWindow.querySelectorAll('button, div[role="button"]');
            for (const btn of buttons) {
              const text = btn.textContent.trim();
              if (text === 'Send' && btn.getAttribute('role') === 'button') {
                btn.click();
                break;
              }
            }
          }
        } else if (action === 'keyboard') {
          // Trigger keyboard shortcut programmatically
          // Note: This may not work due to browser security, so we'll try button click as fallback
          const sendButton = composeWindow.querySelector('[aria-label*="Send"]:not([aria-label*="draft"]):not([aria-label*="schedule"])');
          if (sendButton) {
            sendButton.click();
          } else {
            // Try to dispatch keyboard event (may not work in all browsers)
            const isMac = navigator.platform.includes('Mac');
            const event = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              metaKey: isMac,
              ctrlKey: !isMac,
              bubbles: true,
              cancelable: true
            });
            composeWindow.dispatchEvent(event);
          }
        }
      }

      // Reset flag after a delay to allow send to complete
      setTimeout(() => {
        isResumingSend = false;
      }, 500);
    }, 100);
  }

})();

