// Utility functions - centralized utility functions for all pages

// Loading overlay management
function showLoading(show) {
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (loadingOverlay) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
  }
}

// Message display system
function showMessage(message, type) {
  // Remove existing messages
  const existingMessages = document.querySelectorAll('.message');
  existingMessages.forEach(msg => msg.remove());
  
  // Create new message
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = message;
  
  // Insert at the top of the container
  const container = document.querySelector('.container');
  if (container) {
    container.insertBefore(messageDiv, container.firstChild);
  } else {
    // Fallback: append to body
    document.body.appendChild(messageDiv);
  }
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 5000);
}

// Date formatting utility
function formatTransactionDate(dateString) {
  // Parse date string directly to avoid timezone conversion issues
  if (!dateString) return 'Unknown Date';
  
  // If it's already in YYYY-MM-DD format, parse it directly
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateString.split('-');
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  }
  
  // Fallback to Date parsing for other formats
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  } catch (error) {
    console.error('Error parsing date:', dateString, error);
    return 'Invalid Date';
  }
}

// Sign out functionality
function handleSignOut() {
  // Clear cache before signing out for security
  if (window.dataCache) {
    console.log('🧹 Clearing cache on sign out for security');
    window.dataCache.clear();
  }
  
  if (window.msalInstance) {
    window.msalInstance.logout();
    localStorage.clear();
    window.location.replace('/index.html');
  } else {
    localStorage.clear();
    window.location.replace('/index.html');
  }
}

// Make functions globally available
window.showLoading = showLoading;
window.showMessage = showMessage;
window.formatTransactionDate = formatTransactionDate;
window.handleSignOut = handleSignOut;
