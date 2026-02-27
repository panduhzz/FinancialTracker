// Update scripts/build-local.js
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.development for local, or use GitHub secrets for production
require('dotenv').config({ path: '.env.development' });

// Environment-specific configuration
const getEnvironmentConfig = () => {
  const environment = process.env.REACT_APP_ENVIRONMENT || 'development';
  
  if (environment === 'production') {
    return {
      REACT_APP_API_URL: process.env.REACT_APP_API_URL, // Main backend API URL
      REACT_APP_UPLOAD_API_URL: process.env.REACT_APP_UPLOAD_API_URL, // Upload backend API URL
      REACT_APP_ENVIRONMENT: 'production',
      REACT_APP_DEBUG: 'false',
      REACT_APP_FIREBASE_API_KEY: process.env.REACT_APP_FIREBASE_API_KEY || '',
      REACT_APP_FIREBASE_AUTH_DOMAIN: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
      REACT_APP_FIREBASE_PROJECT_ID: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
    };
  } else {
    return {
      REACT_APP_API_URL: process.env.REACT_APP_API_URL || 'http://localhost:7071/api', // Main backend fallback
      REACT_APP_UPLOAD_API_URL: process.env.REACT_APP_UPLOAD_API_URL || 'http://localhost:7072/api', // Upload backend fallback
      REACT_APP_ENVIRONMENT: 'development',
      REACT_APP_DEBUG: 'true',
      REACT_APP_FIREBASE_API_KEY: process.env.REACT_APP_FIREBASE_API_KEY || '',
      REACT_APP_FIREBASE_AUTH_DOMAIN: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
      REACT_APP_FIREBASE_PROJECT_ID: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
    };
  }
};

function injectEnvironmentVariables() {
  const htmlFiles = [
    'src/index.html',
    'src/loggedIn.html',
    'src/financialTracking.html',
    'src/accounts.html'
  ];

  const config = getEnvironmentConfig();

  // Validate that production has required environment variables
  if (config.REACT_APP_ENVIRONMENT === 'production') {
    if (!config.REACT_APP_API_URL) {
      throw new Error('REACT_APP_API_URL is required for production builds');
    }
    if (!config.REACT_APP_UPLOAD_API_URL) {
      throw new Error('REACT_APP_UPLOAD_API_URL is required for production builds');
    }
  }

  htmlFiles.forEach(file => {
    if (fs.existsSync(file)) {
      let content = fs.readFileSync(file, 'utf8');
      
      // Remove existing environment injection
      content = content.replace(/<script>\s*window\.REACT_APP_[^<]*<\/script>\s*/g, '');
      
      // Inject environment variables
      const envScript = `<script>
  window.REACT_APP_API_URL = '${config.REACT_APP_API_URL}';
  window.REACT_APP_UPLOAD_API_URL = '${config.REACT_APP_UPLOAD_API_URL}';
  window.REACT_APP_ENVIRONMENT = '${config.REACT_APP_ENVIRONMENT}';
  window.REACT_APP_DEBUG = ${config.REACT_APP_DEBUG};
  window.REACT_APP_FIREBASE_API_KEY = '${config.REACT_APP_FIREBASE_API_KEY}';
  window.REACT_APP_FIREBASE_AUTH_DOMAIN = '${config.REACT_APP_FIREBASE_AUTH_DOMAIN}';
  window.REACT_APP_FIREBASE_PROJECT_ID = '${config.REACT_APP_FIREBASE_PROJECT_ID}';
</script>`;
      
      if (content.includes('</head>')) {
        content = content.replace('</head>', `  ${envScript}\n</head>`);
      } else {
        content = envScript + '\n' + content;
      }
      
      fs.writeFileSync(file, content);
      console.log(`✅ Injected environment variables into ${file}`);
    }
  });
}

injectEnvironmentVariables();
console.log('🚀 Build complete! Environment variables injected.');