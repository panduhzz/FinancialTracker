// API Configuration - centralized configuration for all pages
const API_CONFIG = {
  getBaseUrl: function() {
    // Method 1: Use runtime environment variables (injected by build script)
    if (window.REACT_APP_API_URL) {
      return window.REACT_APP_API_URL;
    }
    
    // Method 2: Use global window variable (fallback)
    if (window.API_URL) {
      return window.API_URL;
    }
    
    // Method 3: Use meta tag (alternative)
    const metaApiUrl = document.querySelector('meta[name="api-url"]');
    if (metaApiUrl) {
      return metaApiUrl.getAttribute('content');
    }
    
    // Method 4: Fallback based on environment detection
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:7071/api';
    } else {
      return '/api';
    }
  },
  
  getUploadApiUrl: function() {
    // Method 1: Use runtime environment variables (injected by build script)
    if (window.REACT_APP_UPLOAD_API_URL) {
      return window.REACT_APP_UPLOAD_API_URL;
    }
    
    // Method 2: Use global window variable (fallback)
    if (window.UPLOAD_API_URL) {
      return window.UPLOAD_API_URL;
    }
    
    // Method 3: Use meta tag (alternative)
    const metaUploadApiUrl = document.querySelector('meta[name="upload-api-url"]');
    if (metaUploadApiUrl) {
      return metaUploadApiUrl.getAttribute('content');
    }
    
    // Method 4: Fallback based on environment detection
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:7072/api';
    } else {
      return '/upload-api';
    }
  },
  
  // Debug method to log current configuration
  logConfig: function() {
    console.log('API Configuration:', {
      hostname: window.location.hostname,
      baseUrl: this.getBaseUrl(),
      uploadApiUrl: this.getUploadApiUrl(),
      environment: this.getEnvironment(),
      runtimeEnv: window.REACT_APP_API_URL || 'N/A',
      uploadRuntimeEnv: window.REACT_APP_UPLOAD_API_URL || 'N/A',
      debug: window.REACT_APP_DEBUG || 'N/A'
    });
  },
  
  getEnvironment: function() {
    if (window.REACT_APP_ENVIRONMENT) {
      return window.REACT_APP_ENVIRONMENT;
    }
    
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'development';
    } else if (hostname.includes('.azurestaticapps.net')) {
      return 'production';
    } else {
      return 'production';
    }
  }
};

// Make API_CONFIG globally available
window.API_CONFIG = API_CONFIG;
