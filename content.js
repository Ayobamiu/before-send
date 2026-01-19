// Before You Send - Gmail Send Interceptor
// Content script that runs on Gmail pages

(function () {
  'use strict';

  console.log('Before You Send: Extension loaded on Gmail');

  let sendIntercepted = false;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    console.log('Before You Send: Initializing...');
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

    console.log('Before You Send: Send interception set up');
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
          console.log('Before You Send: Intercepted Cmd/Ctrl+Enter');
          interceptSend('keyboard');
        } else {
          console.log('Before You Send: Send already intercepted, preventing duplicate');
        }
      }
    }
  }

  /**
   * Handle Send button click
   */
  function handleSendButtonClick(event) {
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
        console.log('Before You Send: Intercepted Send button click');
        interceptSend('button');
      } else {
        console.log('Before You Send: Send already intercepted, preventing duplicate');
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
   */
  function findComposeWindow() {
    // Gmail compose window can be identified by:
    // - Elements with role="dialog" that contain compose elements
    const dialogs = document.querySelectorAll('[role="dialog"]');

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

    return null;
  }

  /**
   * Intercept send action and prevent it temporarily
   */
  function interceptSend(source) {
    if (sendIntercepted) {
      console.log('Before You Send: Already processing a send, ignoring duplicate');
      return;
    }

    sendIntercepted = true;
    console.log('Before You Send: Send intercepted from', source);

    // Step 3: Extract email data
    const emailData = extractEmailData();
    console.log('Before You Send: Extracted email data:', emailData);

    // TODO: Step 4 will run checks here
    // TODO: Step 5 will show modal if warnings exist
    // TODO: Step 6 will resume send if no warnings or user confirms
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

})();

